import { z } from 'zod';
import { match } from 'ts-pattern';
import { readSecrets } from './env';
import { BODY_MAX, NewItem, type StoredItem } from './items';
import { isCompanyName } from './parties';
import { deleteParties, getCursor, getItems, recordRun, saveAnswers, saveDetail, untaggedIds, upsertItems } from './db';
import { makeClient, tagItem, USD_PER_MILLION_INPUT_TOKENS } from './jev/tag';
import { TAG_VERSION } from './jev/questions';
import { SOURCES, sourceById } from './sources';
import { getText } from './sources/http';
import type { SourceError } from './sources/types';

// The Workers Free plan gives each invocation 10 ms of CPU and 50 subrequests.
// Thus one ingest message is one page of one source, and one item message is
// a small group of items.
export const IngestMessage = z.object({ sourceId: z.string(), page: z.unknown().default(null) });
export const ItemMessage = z.object({ itemIds: z.array(z.string()).min(1), attempt: z.number().int().default(1) });

export const ITEMS_PER_MESSAGE = 10;
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

export const scheduleAll = async (env: Env) => {
  await env.INGEST_QUEUE.sendBatch(SOURCES.map((source) => ({ body: { sourceId: source.id, page: null } })));
};

export const sendItemMessages = async ({ env, itemIds, attempt = 1, delaySeconds = 0 }: { env: Env; itemIds: string[]; attempt?: number; delaySeconds?: number }) => {
  const messages = chunks(itemIds, ITEMS_PER_MESSAGE).map((group) => ({ body: { itemIds: group, attempt }, delaySeconds }));
  // A send batch holds at most 100 messages.
  await Promise.all(chunks(messages, 100).map((batch) => env.ITEM_QUEUE.sendBatch(batch)));
};

// Runs one page of one source. The next page, if any, goes back on the queue.
export const ingestPage = async ({ env, sourceId, page }: { env: Env; sourceId: string; page: unknown }) => {
  const source = sourceById(sourceId);
  if (source === undefined) throw new Error(`Unknown source: ${sourceId}`);
  const startedAt = new Date();
  const cursor = await getCursor(env.DB)(sourceId);
  const outcome = await source.run({ cursor, now: startedAt, page });
  const run = { sourceId, startedAt, firstPage: page === null };

  if (outcome.isErr()) {
    const message = describeError(outcome.error);
    console.error(JSON.stringify({ event: 'ingest_failed', sourceId, error: message }));
    await recordRun(env.DB)({ ...run, finishedAt: new Date(), status: 'error', seen: 0, added: 0, dropped: 0, error: message, cursor: null });
    return;
  }

  if (outcome.value.type === 'unchanged') {
    const purged = source.kind === 'enforcement' ? await deleteParties(env.DB)({ sourceId, keep: isCompanyName }) : 0;
    console.log(JSON.stringify({ event: 'ingest_unchanged', sourceId, purged }));
    await recordRun(env.DB)({ ...run, finishedAt: new Date(), status: 'unchanged', seen: 0, added: 0, dropped: 0, error: null, cursor: null });
    return;
  }

  const { records, raw, cursor: nextCursor, next } = outcome.value;
  const day = startedAt.toISOString().slice(0, 10);
  await Promise.all(raw.map((file) => env.RAW.put(`${sourceId}/${day}/${file.name}`, file.body)));

  const checked = checkRecords(records);
  const changedIds = await upsertItems(env.DB)({ sourceId, items: checked.items, now: startedAt });
  await sendItemMessages({ env, itemIds: changedIds });

  const isLast = next === null;
  if (!isLast) await env.INGEST_QUEUE.send({ sourceId, page: next });
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
};

// Also finds items with an old tag version, for example after a question changes.
// `minAgeHours` skips items that a run in progress sent to the queue already.
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
  await saveDetail(env.DB)({ itemId: item.id, body, now: new Date() });
  return { ...item, body, detailFetchedAt: new Date().toISOString() };
};

// Returns the IDs that failed.
export const processItems = async ({ env, itemIds, detailRequired }: { env: Env; itemIds: string[]; detailRequired: boolean }) => {
  const client = makeClient(readSecrets(env).TYPESAFE_API_KEY);
  const loaded = await getItems(env.DB)(itemIds);
  const detailed = await Promise.allSettled(loaded.map((item) => withDetail({ env, item, required: detailRequired })));
  const ready = detailed.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
  const detailFailures = detailed.flatMap((result, i) => (result.status === 'rejected' ? [loaded[i]?.id ?? ''] : []));
  detailed.forEach((result) => {
    if (result.status === 'rejected') console.error(JSON.stringify({ event: 'detail_failed', error: String(result.reason) }));
  });

  const results = await Promise.all(ready.map(tagItem(client)));
  const now = new Date();
  await Promise.all(results.flatMap((result) => (result.isOk() ? [saveAnswers(env.DB)({ ...result.value, version: TAG_VERSION, now })] : [])));
  const tagFailures = results.flatMap((result) => (result.isErr() ? [result.error] : []));
  tagFailures.forEach((failure) => console.error(JSON.stringify({ event: 'tag_failed', itemId: failure.itemId, error: String(failure.cause) })));
  const inputTokens = results.reduce((sum, result) => sum + (result.isOk() ? result.value.inputTokens : 0), 0);
  console.log(
    JSON.stringify({
      event: 'tag_batch',
      tagged: results.length - tagFailures.length,
      failed: tagFailures.length + detailFailures.length,
      inputTokens,
      costUsd: (inputTokens * USD_PER_MILLION_INPUT_TOKENS) / 1e6,
    }),
  );
  return [...detailFailures, ...tagFailures.map((failure) => failure.itemId)];
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
