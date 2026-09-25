import { afterEach, describe, expect, it, vi } from 'vitest';
import { inboxPage, saveAnswers, saveTriage, upsertItems, type Scope, type Tab } from '../src/db';
import type { NewItem } from '../src/items';
import { TAG_VERSION } from '../src/jev/questions';
import { handleItemQueueMessage, ingestPage } from '../src/pipeline';
import { ftsFilter } from '../src/search';
import { testDb } from './d1';

const now = new Date('2026-09-24T00:00:00Z');

// Title names JJ Richards, so items reach inbox with no Jev answers.
const item = (externalId: string, over: Partial<Extract<NewItem, { kind: 'regulatory' }>> = {}): NewItem => ({
  kind: 'regulatory',
  externalId,
  jurisdiction: 'QLD',
  title: `JJ Richards item ${externalId}`,
  url: 'https://example.com/item',
  publishedAt: '2026-09-01',
  body: 'Text.',
  detailUrl: null,
  ...over,
});

const hashOf = (rows: ReturnType<typeof testDb>['rows'], id: string) => String(rows('SELECT content_hash FROM items WHERE id = ?', id)[0]?.content_hash);

const tag = ({ db, rows }: ReturnType<typeof testDb>, id: string, contentHash = hashOf(rows, id)) =>
  saveAnswers(db)({ itemId: id, contentHash, answers: {}, version: TAG_VERSION, now, penaltyAud: null, closesOn: null, startsOn: null });

describe('upsertItems', () => {
  it('gives only new or changed items, and a change clears the tags', async () => {
    const t = testDb();
    const upsert = (items: NewItem[]) => upsertItems(t.db)({ sourceId: 'test', items, now });
    expect(await upsert([item('a')])).toEqual(['test:a']);
    await tag(t, 'test:a');
    expect(await upsert([item('a')])).toEqual([]);
    expect(await upsert([item('a', { body: 'New text.' })])).toEqual(['test:a']);
    expect(t.rows('SELECT tag_version FROM items')).toEqual([{ tag_version: null }]);
  });

  it('does not save answers for an older text', async () => {
    const t = testDb();
    await upsertItems(t.db)({ sourceId: 'test', items: [item('a')], now });
    const oldHash = hashOf(t.rows, 'test:a');
    await upsertItems(t.db)({ sourceId: 'test', items: [item('a', { body: 'New text.' })], now });
    await tag(t, 'test:a', oldHash);
    expect(t.rows('SELECT tag_version FROM items')).toEqual([{ tag_version: null }]);
  });
});

describe('inboxPage', () => {
  const scope = (over: Partial<Scope> = {}): Scope => ({
    version: TAG_VERSION,
    period: undefined,
    jurisdiction: undefined,
    company: undefined,
    topic: undefined,
    type: undefined,
    priority: undefined,
    match: undefined,
    ...over,
  });

  const setup = async () => {
    const t = testDb();
    const items = [
      item('a', { body: 'The waste levy rises.' }),
      item('b', { jurisdiction: 'NSW', publishedAt: '2026-09-10' }),
      item('c', { publishedAt: '2025-01-01' }),
      item('d', { publishedAt: '2026-09-05' }),
    ];
    const ids = await upsertItems(t.db)({ sourceId: 'test', items, now });
    for (const id of ids) await tag(t, id);
    await saveTriage(t.db)({ itemId: 'test:c', status: 'acting', note: null, now });
    await saveTriage(t.db)({ itemId: 'test:d', status: 'dismissed', note: null, now });
    const page = async (tab: Tab, s = scope()) => {
      const result = await inboxPage(t.db)({ scope: s, defaultPeriod: { from: '2026-06-26', to: '2026-09-24' }, tab, sort: 'priority', limit: 50, offset: 0 });
      return { ids: result.rows.map((row) => row.item.id).toSorted(), counts: result.counts };
    };
    return page;
  };

  it('counts each tab, and applies the default period to new items only', async () => {
    const page = await setup();
    expect(await page('new')).toEqual({ ids: ['test:a', 'test:b'], counts: { new: 2, acting: 1, done: 1 } });
    expect((await page('acting')).ids).toEqual(['test:c']);
  });

  it('applies a period, a jurisdiction and words together', async () => {
    const page = await setup();
    const filtered = scope({ period: { from: '2026-08-01', to: '2026-09-30' }, jurisdiction: 'QLD', match: ftsFilter('levy') });
    expect(await page('new', filtered)).toEqual({ ids: ['test:a'], counts: { new: 1, acting: 0, done: 0 } });
  });
});

const queues = () => ({ INGEST_QUEUE: { send: vi.fn() }, ITEM_QUEUE: { sendBatch: vi.fn() } });
const respond = (body: unknown, status = 200) => vi.stubGlobal('fetch', vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })));

describe('ingestPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  const title = (i: number, day: string) => ({
    id: `F2026L${String(i).padStart(5, '0')}`,
    name: `Title ${i}`,
    collection: 'LegislativeInstrument',
    asMadeRegisteredAt: `${day}T00:00:00`,
    makingDate: null,
    administeringDepartments: [],
  });

  it('moves the cursor only after the last page', async () => {
    const t = testDb();
    const env = { DB: t.db, ...queues() };
    const cursor = () => t.rows('SELECT cursor FROM source_state')[0]?.cursor;

    respond({ value: Array.from({ length: 200 }, (_, i) => title(i, '2026-09-10')) });
    const first = await ingestPage({ env: env as unknown as Env, sourceId: 'frl', page: null, since: null });
    expect(first.next).toMatchObject({ page: 1 });
    expect(cursor()).toBeNull();
    expect(env.INGEST_QUEUE.send).toHaveBeenCalledWith({ sourceId: 'frl', page: first.next, since: null });
    expect(env.ITEM_QUEUE.sendBatch.mock.calls[0]?.[0]).toHaveLength(20);

    respond({ value: [title(900, '2026-09-12')] });
    const last = await ingestPage({ env: env as unknown as Env, sourceId: 'frl', page: first.next, since: null });
    expect(last.next).toBeNull();
    expect(cursor()).toBe('2026-09-12T00:00:00');
  });

  it('purges records that name a person one time for each rule version', async () => {
    const t = testDb();
    const env = { DB: t.db, ...queues() } as unknown as Env;
    const addPerson = (id: string) =>
      t.rows(
        `INSERT INTO items (id, source_id, kind, jurisdiction, title, url, party, content_hash, first_seen_at)
         VALUES (?, 'wa-enforcement', 'enforcement', 'WA', 'Prosecution', 'https://example.com', 'John Smith', 'h', '2026-09-01')`,
        id,
      );
    const stored = () => t.rows('SELECT id FROM items').map((row) => row.id);

    respond('<p>No tables.</p>');
    addPerson('wa-enforcement:1');
    await ingestPage({ env, sourceId: 'wa-enforcement', page: null, since: null });
    expect(stored()).toEqual([]);

    addPerson('wa-enforcement:2');
    await ingestPage({ env, sourceId: 'wa-enforcement', page: null, since: null });
    expect(stored()).toEqual(['wa-enforcement:2']);
  });
});

describe('item queue', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends only the failed items back, and stops after the last attempt', async () => {
    const t = testDb();
    const env = { DB: t.db, ...queues(), TYPESAFE_API_KEY: 'key', DASHBOARD_PASSWORD: 'password', SESSION_SECRET: 'x'.repeat(32) };
    const itemIds = await upsertItems(t.db)({ sourceId: 'test', items: [item('a'), item('b')], now });
    respond({ error: 'Bad request' }, 400);

    await handleItemQueueMessage({ env: env as unknown as Env, message: { type: 'tag', itemIds, attempt: 1 } });
    expect(env.ITEM_QUEUE.sendBatch).toHaveBeenCalledWith([{ body: { type: 'tag', itemIds, attempt: 2 }, delaySeconds: 60 }]);

    env.ITEM_QUEUE.sendBatch.mockClear();
    await handleItemQueueMessage({ env: env as unknown as Env, message: { type: 'tag', itemIds, attempt: 5 } });
    expect(env.ITEM_QUEUE.sendBatch).not.toHaveBeenCalled();
  });
});
