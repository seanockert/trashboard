import { z } from 'zod';
import { match } from 'ts-pattern';
import { readSecrets } from './env';
import { BODY_MAX, NewItem, type StoredItem } from './items';
import { COMPANY_RULE_VERSION, groupOf, isCompanyName, PARTIES_VERSION } from './parties';
import { chunks, deleteParties, getItems, getSourceState, recordRun, saveAnswers, saveDetail, saveGroups, saveSummary, sourcesRunBefore, staleGroupIds, unsummarisedIds, untaggedAmong, untaggedIds, upsertItems } from './db';
import { makeClient, tagItem, USD_PER_MILLION_INPUT_TOKENS } from './jev/tag';
import { TAG_VERSION } from './jev/questions';
import { SOURCES, sourceById } from './sources';
import { FIRST_RUN_DAYS } from './sources/common';
import { summarise, SUMMARY_VERSION } from './summary';
import { getText } from './sources/http';
import type { SourceError } from './sources/types';

// Workers Free: 10 ms CPU, 50 subrequests per invocation. Thus one page per ingest message, few items per item message.
export const IngestMessage = z.object({ sourceId: z.string(), page: z.unknown().default(null), since: z.string().nullable().default(null) });

const ids = z.array(z.string()).min(1);
export const ItemQueueMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('tag'), itemIds: ids, attempt: z.number().int().default(1) }),
  z.object({ type: z.literal('summarise'), itemIds: ids }),
  z.object({ type: z.literal('regroup'), itemIds: ids }),
]);
type ItemQueueMessage = z.infer<typeof ItemQueueMessage>;

const ITEMS_PER_MESSAGE = 10;
const REGROUP_PER_MESSAGE = 50;
const MAX_ATTEMPTS = 5;

const describeError = (error: SourceError) =>
  match(error)
    .with({ type: 'http' }, (e) => `HTTP ${e.status} from ${e.url}`)
    .with({ type: 'network' }, (e) => `Network error for ${e.url}: ${String(e.cause)}`)
    .with({ type: 'parse' }, (e) => `Parse error for ${e.url}: ${e.message}`)
    .exhaustive();

// Privacy: drop enforcement records without a clear company, before storage and before Jev.
const keepRecord = (item: NewItem) => item.kind === 'regulatory' || isCompanyName(item.party);

type Checked = { items: NewItem[]; invalid: number; dropped: number };

const checkRecords = (records: unknown[]): Checked => {
  const checked: Checked = { items: [], invalid: 0, dropped: 0 };
  for (const record of records) {
    const parsed = NewItem.safeParse(record);
    if (!parsed.success) checked.invalid += 1;
    else if (keepRecord(parsed.data)) checked.items.push(parsed.data);
    else checked.dropped += 1;
  }
  return checked;
};

const scheduleAll = async (env: Env) => {
  const runBefore = new Set(await sourcesRunBefore(env.DB)());
  const firstRunSince = new Date(Date.now() - FIRST_RUN_DAYS * 86_400_000).toISOString();
  await env.INGEST_QUEUE.sendBatch(SOURCES.filter((source) => source.manualOnly !== true).map((source) => ({ body: { sourceId: source.id, page: null, since: runBefore.has(source.id) ? null : firstRunSince } })));
};

const RETAG_LIMIT = 2000;

// About 6 neurons each: about 3,600 of 10,000 free neurons/day.
const SUMMARY_LIMIT = 600;

const REGROUP_LIMIT = 5000;

// minAgeHours 6 skips new items that source runs sent to the queue already.
export const updateAll = (env: Env) =>
  Promise.all([
    scheduleAll(env),
    retagStale({ env, limit: RETAG_LIMIT, minAgeHours: 6 }),
    summariseStale({ env, limit: SUMMARY_LIMIT }),
    regroupStale({ env, limit: REGROUP_LIMIT }),
  ]);

// Send batch limit: 100 messages.
const sendAll = async (env: Env, messages: MessageSendRequest<ItemQueueMessage>[]) => {
  await Promise.all(chunks(messages, 100).map((batch) => env.ITEM_QUEUE.sendBatch(batch)));
};

const sendItemMessages = ({ env, itemIds, attempt = 1, delaySeconds = 0 }: { env: Env; itemIds: string[]; attempt?: number; delaySeconds?: number }) =>
  sendAll(
    env,
    chunks(itemIds, ITEMS_PER_MESSAGE).map((group) => ({ body: { type: 'tag', itemIds: group, attempt }, delaySeconds })),
  );

export const ingestPage = async ({
  env,
  sourceId,
  page,
  since,
  firstPage = page === null,
  chain = true,
}: {
  env: Env;
  sourceId: string;
  page: unknown;
  since: string | null;
  firstPage?: boolean;
  chain?: boolean;
}): Promise<{ next: unknown; error: string | null }> => {
  const source = sourceById(sourceId);
  if (source === undefined) throw new Error(`Unknown source: ${sourceId}`);
  const startedAt = new Date();
  const { cursor, purgeVersion } = await getSourceState(env.DB)(sourceId);
  const outcome = await source.run({ cursor, now: startedAt, page, since });
  const run = { sourceId, startedAt, firstPage };
  const purge = async () => (source.kind === 'enforcement' && purgeVersion !== COMPANY_RULE_VERSION ? deleteParties(env.DB)({ sourceId, keep: isCompanyName }) : 0);

  if (outcome.isErr()) {
    const message = describeError(outcome.error);
    console.error(JSON.stringify({ event: 'ingest_failed', sourceId, error: message }));
    await recordRun(env.DB)({ ...run, finishedAt: new Date(), status: 'error', seen: 0, added: 0, dropped: 0, error: message, cursor: null });
    return { next: null, error: message };
  }

  if (outcome.value.type === 'unchanged') {
    const purged = await purge();
    console.log(JSON.stringify({ event: 'ingest_unchanged', sourceId, purged }));
    await recordRun(env.DB)({ ...run, finishedAt: new Date(), status: 'unchanged', seen: 0, added: 0, dropped: 0, error: null, cursor: null });
    return { next: null, error: null };
  }

  const { records, cursor: nextCursor, next } = outcome.value;

  const checked = checkRecords(records);
  const changedIds = await upsertItems(env.DB)({ sourceId, items: checked.items, now: startedAt });
  await sendItemMessages({ env, itemIds: changedIds });

  const isLast = next === null;
  const purged = isLast ? await purge() : 0;

  const error = checked.invalid > 0 ? `${checked.invalid} records failed the schema check` : null;
  console.log(
    JSON.stringify({ event: 'ingest_ok', sourceId, seen: records.length, changed: changedIds.length, dropped: checked.dropped, purged, invalid: checked.invalid, isLast }),
  );
  // Cursor moves only after last page. A stopped chain starts again from the old cursor.
  await recordRun(env.DB)({
    ...run,
    finishedAt: new Date(),
    status: 'ok',
    seen: records.length,
    added: changedIds.length,
    dropped: checked.dropped,
    error,
    cursor: isLast ? nextCursor : null,
  });
  // Next page goes on the queue last, thus a retry cannot start a second chain.
  if (!isLast && chain) await env.INGEST_QUEUE.send({ sourceId, page: next, since });
  return { next, error };
};

const retagStale = async ({ env, limit, minAgeHours }: { env: Env; limit: number; minAgeHours: number }) => {
  const ids = await untaggedIds(env.DB)({ version: TAG_VERSION, limit, seenBefore: new Date(Date.now() - minAgeHours * 3_600_000) });
  await sendItemMessages({ env, itemIds: ids });
  return ids.length;
};

const withDetail = async ({ env, item, required }: { env: Env; item: StoredItem; required: boolean }): Promise<StoredItem> => {
  const extract = sourceById(item.sourceId)?.extractDetail;
  if (item.detailUrl === null || item.detailFetchedAt !== null || extract === undefined) return item;
  const page = await getText({ url: item.detailUrl });
  if (page.isErr() && !required) {
    console.error(JSON.stringify({ event: 'detail_skipped', itemId: item.id, error: describeError(page.error) }));
    return item;
  }
  if (page.isErr()) throw new Error(`Detail fetch failed for ${item.id}: ${describeError(page.error)}`);
  const body = extract(page.value.text).slice(0, BODY_MAX);
  const partyGroup = groupOf({ ...item, body });
  await saveDetail(env.DB)({ itemId: item.id, contentHash: item.contentHash, body, group: partyGroup, now: new Date() });
  return { ...item, body, partyGroup, detailFetchedAt: new Date().toISOString() };
};

// A failed summary does not fail the message: tags are saved, daily run asks again.
const summariseItems = async ({ env, items }: { env: Env; items: StoredItem[] }) => {
  const ids = new Set(await unsummarisedIds(env.DB)({ tagVersion: TAG_VERSION, version: SUMMARY_VERSION, limit: items.length, ids: items.map((item) => item.id) }));
  const todo = items.filter((item) => ids.has(item.id));
  if (todo.length === 0) return;
  const results = await Promise.allSettled(
    todo.map(async (item) => {
      const { summary, neurons } = await summarise({ ai: env.AI, item });
      await saveSummary(env.DB)({ itemId: item.id, contentHash: item.contentHash, summary, version: SUMMARY_VERSION });
      return { usable: summary !== null, neurons };
    }),
  );
  results.forEach((result, i) => {
    if (result.status === 'rejected') console.error(JSON.stringify({ event: 'summary_failed', itemId: todo[i]?.id, error: String(result.reason) }));
  });
  const done = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
  console.log(
    JSON.stringify({
      event: 'summary_batch',
      summarised: done.filter((d) => d.usable).length,
      unusable: done.filter((d) => !d.usable).length,
      failed: results.length - done.length,
      neurons: done.reduce((sum, d) => sum + d.neurons, 0),
    }),
  );
};

const summariseStale = async ({ env, limit }: { env: Env; limit: number }) => {
  const ids = await unsummarisedIds(env.DB)({ tagVersion: TAG_VERSION, version: SUMMARY_VERSION, limit });
  await sendAll(
    env,
    chunks(ids, ITEMS_PER_MESSAGE).map((group) => ({ body: { type: 'summarise', itemIds: group } })),
  );
  return ids.length;
};

const regroupStale = async ({ env, limit }: { env: Env; limit: number }) => {
  const ids = await staleGroupIds(env.DB)({ version: PARTIES_VERSION, limit });
  await sendAll(
    env,
    chunks(ids, REGROUP_PER_MESSAGE).map((group) => ({ body: { type: 'regroup', itemIds: group } })),
  );
  return ids.length;
};

const regroupItems = async ({ env, itemIds }: { env: Env; itemIds: string[] }) => {
  const items = await getItems(env.DB)(itemIds);
  await saveGroups(env.DB)({ groups: items.map((item) => ({ itemId: item.id, group: groupOf(item) })), version: PARTIES_VERSION });
};

const processItems = async ({ env, itemIds, detailRequired }: { env: Env; itemIds: string[]; detailRequired: boolean }) => {
  const client = makeClient(readSecrets(env).TYPESAFE_API_KEY);
  const loaded = await getItems(env.DB)(await untaggedAmong(env.DB)({ version: TAG_VERSION, ids: itemIds }));
  const detailed = await Promise.allSettled(loaded.map((item) => withDetail({ env, item, required: detailRequired })));
  const ready = detailed.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
  const detailFailures = detailed.flatMap((result, i) => (result.status === 'rejected' ? [loaded[i]?.id ?? ''] : []));
  detailed.forEach((result) => {
    if (result.status === 'rejected') console.error(JSON.stringify({ event: 'detail_failed', error: String(result.reason) }));
  });

  const results = await Promise.all(ready.map(tagItem(client)));
  const now = new Date();
  // A failed save requeues only that item.
  const tagged = results.flatMap((result, i) => {
    const item = ready[i];
    return result.isOk() && item !== undefined ? [{ item, tags: result.value }] : [];
  });
  const saves = await Promise.allSettled(tagged.map(({ item, tags }) => saveAnswers(env.DB)({ ...tags, contentHash: item.contentHash, version: TAG_VERSION, now })));
  const saveFailures = saves.flatMap((save, i) => (save.status === 'rejected' ? [{ itemId: tagged[i]?.item.id ?? '', cause: save.reason }] : []));
  saveFailures.forEach((failure) => console.error(JSON.stringify({ event: 'save_failed', itemId: failure.itemId, error: String(failure.cause) })));
  const tagFailures = results.flatMap((result) => (result.isErr() ? [result.error] : []));
  const failedIds = new Set([...tagFailures, ...saveFailures].map((failure) => failure.itemId));
  await summariseItems({ env, items: ready.filter((item) => !failedIds.has(item.id)) });
  tagFailures.forEach((failure) => console.error(JSON.stringify({ event: 'tag_failed', itemId: failure.itemId, error: String(failure.cause) })));
  const inputTokens = results.reduce((sum, result) => sum + (result.isOk() ? result.value.inputTokens : 0), 0);
  console.log(
    JSON.stringify({
      event: 'tag_batch',
      tagged: results.length - tagFailures.length,
      failed: tagFailures.length + saveFailures.length + detailFailures.length,
      inputTokens,
      costUsd: (inputTokens * USD_PER_MILLION_INPUT_TOKENS) / 1e6,
    }),
  );
  return [...detailFailures, ...failedIds];
};

// Requeue only failed IDs. Last attempt skips detail page: title tags are better than no tags.
const tagItems = async ({ env, message }: { env: Env; message: Extract<ItemQueueMessage, { type: 'tag' }> }) => {
  const failed = await processItems({ env, itemIds: message.itemIds, detailRequired: message.attempt < MAX_ATTEMPTS });
  if (failed.length === 0) return;
  if (message.attempt >= MAX_ATTEMPTS) {
    console.error(JSON.stringify({ event: 'tag_gave_up', itemIds: failed, attempts: message.attempt }));
    return;
  }
  await sendItemMessages({ env, itemIds: failed, attempt: message.attempt + 1, delaySeconds: 60 * message.attempt });
};

export const handleItemQueueMessage = ({ env, message }: { env: Env; message: ItemQueueMessage }) =>
  match(message)
    .with({ type: 'tag' }, (m) => tagItems({ env, message: m }))
    .with({ type: 'summarise' }, async (m) => summariseItems({ env, items: await getItems(env.DB)(m.itemIds) }))
    .with({ type: 'regroup' }, (m) => regroupItems({ env, itemIds: m.itemIds }))
    .exhaustive();
