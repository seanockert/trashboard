import { z } from 'zod';
import { match } from 'ts-pattern';
import { readSecrets } from './env';
import { BODY_MAX, NewItem, type StoredItem } from './items';
import { groupOf, isCompanyName, PARTIES_VERSION } from './parties';
import { deleteParties, getCursor, getItems, recordRun, saveAnswers, saveDetail, saveGroups, saveSummary, sourcesRunBefore, staleGroupIds, unsummarisedIds, untaggedAmong, untaggedIds, upsertItems } from './db';
import { makeClient, tagItem, USD_PER_MILLION_INPUT_TOKENS } from './jev/tag';
import { TAG_VERSION } from './jev/questions';
import { SOURCES, sourceById } from './sources';
import { summarise, SUMMARY_VERSION } from './summary';
import { getText } from './sources/http';
import type { SourceError } from './sources/types';

// The Workers Free plan gives each invocation 10 ms of CPU and 50 subrequests.
// Thus one ingest message is one page of one source, and one item message is
// a small group of items.
// `since` starts a backfill from that date. Each page of the run carries it.
export const IngestMessage = z.object({ sourceId: z.string(), page: z.unknown().default(null), since: z.string().nullable().default(null) });
export const ItemMessage = z.object({ itemIds: z.array(z.string()).min(1), attempt: z.number().int().default(1) });
// Items that were tagged before, but have no current summary. Uses the item queue too.
export const SummaryMessage = z.object({ summariseIds: z.array(z.string()).min(1) });
// Items with a group from an older alias list. Uses the item queue too.
export const RegroupMessage = z.object({ regroupIds: z.array(z.string()).min(1) });

export const ITEMS_PER_MESSAGE = 10;
// A regroup needs no requests, thus a message can hold more items.
const REGROUP_PER_MESSAGE = 50;
export const MAX_ATTEMPTS = 5;

const describeError = (error: SourceError) =>
  match(error)
    .with({ type: 'http' }, (e) => `HTTP ${e.status} from ${e.url}`)
    .with({ type: 'network' }, (e) => `Network error for ${e.url}: ${String(e.cause)}`)
    .with({ type: 'parse' }, (e) => `Parse error for ${e.url}: ${e.message}`)
    .exhaustive();

// Personal information stays out of the database. An enforcement record
// that does not clearly name a company is dropped here, before storage and
// before any request to Jev.
const keepRecord = (item: NewItem) => item.kind === 'regulatory' || isCompanyName(item.party);

type Checked = { items: NewItem[]; invalid: number; dropped: number };

const checkRecords = (records: unknown[]): Checked =>
  records.reduce<Checked>(
    (acc, record) => {
      const parsed = NewItem.safeParse(record);
      if (!parsed.success) return { ...acc, invalid: acc.invalid + 1 };
      return keepRecord(parsed.data) ? { ...acc, items: [...acc.items, parsed.data] } : { ...acc, dropped: acc.dropped + 1 };
    },
    { items: [], invalid: 0, dropped: 0 },
  );

const chunks = <T>(list: T[], size: number) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

// A source that has not run before loads the past 12 months. The other sources load only what is new.
const FIRST_RUN_DAYS = 365;

export const scheduleAll = async (env: Env) => {
  const runBefore = new Set(await sourcesRunBefore(env.DB)());
  const firstRunSince = new Date(Date.now() - FIRST_RUN_DAYS * 86_400_000).toISOString();
  await env.INGEST_QUEUE.sendBatch(SOURCES.filter((source) => source.manualOnly !== true).map((source) => ({ body: { sourceId: source.id, page: null, since: runBefore.has(source.id) ? null : firstRunSince } })));
};

// The daily run also sends items that have no current tags, for example
// after a failed batch or a question change.
const RETAG_LIMIT = 2000;

// About 6 neurons each, thus about 3,600 of the 10,000 free neurons each day.
// New items get a summary when they get tags. This limit is for older items.
const SUMMARY_LIMIT = 600;

// Items that get their group again each day after the alias list changes.
const REGROUP_LIMIT = 5000;

// The daily run, and the "Update now" button. Jev tags only items that are new,
// changed, or have tags from an older question version. Thus a second run costs almost nothing.
// `minAgeHours` 6 skips new items that the source runs send to the queue already.
export const updateAll = (env: Env) =>
  Promise.all([
    scheduleAll(env),
    retagStale({ env, limit: RETAG_LIMIT, minAgeHours: 6 }),
    summariseStale({ env, limit: SUMMARY_LIMIT }),
    regroupStale({ env, limit: REGROUP_LIMIT }),
  ]);

// A send batch holds at most 100 messages.
const sendAll = async (env: Env, messages: MessageSendRequest[]) => {
  await Promise.all(chunks(messages, 100).map((batch) => env.ITEM_QUEUE.sendBatch(batch)));
};

export const sendItemMessages = ({ env, itemIds, attempt = 1, delaySeconds = 0 }: { env: Env; itemIds: string[]; attempt?: number; delaySeconds?: number }) =>
  sendAll(
    env,
    chunks(itemIds, ITEMS_PER_MESSAGE).map((group) => ({ body: { itemIds: group, attempt }, delaySeconds })),
  );

// Runs one page of one source. The next page, if any, goes back on the queue.
// With `chain` false, the caller gets the next page and runs it. The relay script uses this.
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
  const cursor = await getCursor(env.DB)(sourceId);
  const outcome = await source.run({ cursor, now: startedAt, page, since });
  const run = { sourceId, startedAt, firstPage };

  if (outcome.isErr()) {
    const message = describeError(outcome.error);
    console.error(JSON.stringify({ event: 'ingest_failed', sourceId, error: message }));
    await recordRun(env.DB)({ ...run, finishedAt: new Date(), status: 'error', seen: 0, added: 0, dropped: 0, error: message, cursor: null });
    return { next: null, error: message };
  }

  if (outcome.value.type === 'unchanged') {
    const purged = source.kind === 'enforcement' ? await deleteParties(env.DB)({ sourceId, keep: isCompanyName }) : 0;
    console.log(JSON.stringify({ event: 'ingest_unchanged', sourceId, purged }));
    await recordRun(env.DB)({ ...run, finishedAt: new Date(), status: 'unchanged', seen: 0, added: 0, dropped: 0, error: null, cursor: null });
    return { next: null, error: null };
  }

  const { records, cursor: nextCursor, next } = outcome.value;

  const checked = checkRecords(records);
  const changedIds = await upsertItems(env.DB)({ sourceId, items: checked.items, now: startedAt });
  await sendItemMessages({ env, itemIds: changedIds });

  const isLast = next === null;
  // A stricter rule for personal information also applies to records stored before it.
  const purged = isLast && source.kind === 'enforcement' ? await deleteParties(env.DB)({ sourceId, keep: isCompanyName }) : 0;

  const error = checked.invalid > 0 ? `${checked.invalid} records failed the schema check` : null;
  console.log(
    JSON.stringify({ event: 'ingest_ok', sourceId, seen: records.length, changed: changedIds.length, dropped: checked.dropped, purged, invalid: checked.invalid, isLast }),
  );
  // The cursor moves only after the last page. A chain that stops halfway starts again from the old cursor.
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
  // The next page goes on the queue last. A retry of this page then cannot start a second chain.
  if (!isLast && chain) await env.INGEST_QUEUE.send({ sourceId, page: next, since });
  return { next, error };
};

// Also finds items with an old tag version, for example after a question changes.
// `minAgeHours` skips new items that a run in progress sent to the queue already. It does not skip changed items.
export const retagStale = async ({ env, limit, minAgeHours }: { env: Env; limit: number; minAgeHours: number }) => {
  const ids = await untaggedIds(env.DB)({ version: TAG_VERSION, limit, seenBefore: new Date(Date.now() - minAgeHours * 3_600_000) });
  await sendItemMessages({ env, itemIds: ids });
  return ids.length;
};

// Fetches the detail page of an item that has one and has no body from it yet.
// With `required` false, a failed fetch gives the item without the detail.
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

// Makes summaries for the items that need one. A failed request does not
// fail the message: the tags are saved already, and the daily run asks again.
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

export const summariseStale = async ({ env, limit }: { env: Env; limit: number }) => {
  const ids = await unsummarisedIds(env.DB)({ tagVersion: TAG_VERSION, version: SUMMARY_VERSION, limit });
  await sendAll(
    env,
    chunks(ids, ITEMS_PER_MESSAGE).map((group) => ({ body: { summariseIds: group } })),
  );
  return ids.length;
};

export const regroupStale = async ({ env, limit }: { env: Env; limit: number }) => {
  const ids = await staleGroupIds(env.DB)({ version: PARTIES_VERSION, limit });
  await sendAll(
    env,
    chunks(ids, REGROUP_PER_MESSAGE).map((group) => ({ body: { regroupIds: group } })),
  );
  return ids.length;
};

export const handleRegroupMessage = async ({ env, message }: { env: Env; message: z.infer<typeof RegroupMessage> }) => {
  const items = await getItems(env.DB)(message.regroupIds);
  await saveGroups(env.DB)({ groups: items.map((item) => ({ itemId: item.id, group: groupOf(item) })), version: PARTIES_VERSION });
};

export const handleSummaryMessage = async ({ env, message }: { env: Env; message: z.infer<typeof SummaryMessage> }) =>
  summariseItems({ env, items: await getItems(env.DB)(message.summariseIds) });

// Returns the IDs that failed.
export const processItems = async ({ env, itemIds, detailRequired }: { env: Env; itemIds: string[]; detailRequired: boolean }) => {
  const client = makeClient(readSecrets(env).TYPESAFE_API_KEY);
  // An item can be in the queue two times, for example from a run and a retag. Jev tags it one time only.
  const loaded = await getItems(env.DB)(await untaggedAmong(env.DB)({ version: TAG_VERSION, ids: itemIds }));
  const detailed = await Promise.allSettled(loaded.map((item) => withDetail({ env, item, required: detailRequired })));
  const ready = detailed.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
  const detailFailures = detailed.flatMap((result, i) => (result.status === 'rejected' ? [loaded[i]?.id ?? ''] : []));
  detailed.forEach((result) => {
    if (result.status === 'rejected') console.error(JSON.stringify({ event: 'detail_failed', error: String(result.reason) }));
  });

  const results = await Promise.all(ready.map(tagItem(client)));
  const now = new Date();
  // A failed save sends only that item back to the queue, not the whole message.
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

// Only the failed IDs go back on the queue, so that a retry does not pay for
// the items that succeeded. The last attempt tags an item without its detail
// page, because tags from the title are better than no tags.
export const handleItemMessage = async ({ env, message }: { env: Env; message: z.infer<typeof ItemMessage> }) => {
  const failed = await processItems({ env, itemIds: message.itemIds, detailRequired: message.attempt < MAX_ATTEMPTS });
  if (failed.length === 0) return;
  if (message.attempt >= MAX_ATTEMPTS) {
    console.error(JSON.stringify({ event: 'tag_gave_up', itemIds: failed, attempts: message.attempt }));
    return;
  }
  await sendItemMessages({ env, itemIds: failed, attempt: message.attempt + 1, delaySeconds: 60 * message.attempt });
};
