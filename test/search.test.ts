import { describe, expect, it, vi } from 'vitest';
import type { TypeSafeClient } from '@typesafe-ai/sdk';
import { addJevTokens, jevTokensOn, upsertItems } from '../src/db';
import type { NewItem } from '../src/items';
import { capReached } from '../src/jev/spend';
import { search, type SearchCache } from '../src/search';
import { testDb } from './d1';

const now = new Date('2026-09-24T00:00:00Z');

const item = (externalId: string): NewItem => ({
  kind: 'regulatory',
  externalId,
  jurisdiction: 'QLD',
  title: `Stormwater rule ${externalId}`,
  url: 'https://example.com/item',
  publishedAt: '2026-09-01',
  body: 'Stormwater text.',
  detailUrl: null,
});

// Fails for item "b". Other items score 0.9 with 100 tokens.
const fakeClient = () => {
  const systemOne = vi.fn(async ({ state }: { state: { candidate: { title: string } } }) => {
    if (state.candidate.title.endsWith(' b')) throw new Error('402');
    return { answers: { helps: { noul: 0.9 } }, usage: { input_tokens: 100 } };
  });
  return { client: { systemOne } as unknown as TypeSafeClient, systemOne };
};

const fakeCache = (): SearchCache => {
  const store = new Map<string, string>();
  return {
    origin: 'https://test.example',
    store: {
      match: async (req: Request) => (store.has(req.url) ? new Response(store.get(req.url)) : undefined),
      put: async (req: Request, res: Response) => void store.set(req.url, await res.text()),
    } as unknown as Cache,
  };
};

const setup = async (ids: string[]) => {
  const t = testDb();
  await upsertItems(t.db)({ sourceId: 'test', items: ids.map(item), now });
  return t;
};

describe('search', () => {
  it('keeps the scored items when one request fails, and does not cache', async () => {
    const t = await setup(['a', 'b', 'c']);
    const { client, systemOne } = fakeClient();
    const cache = fakeCache();
    const result = await search({ db: t.db, client, cache })('stormwater');
    expect(result.hits.map((hit) => hit.item.id).toSorted()).toEqual(['test:a', 'test:c']);
    expect(result.failed).toBe(1);
    expect(result.inputTokens).toBe(200);
    await search({ db: t.db, client, cache })('stormwater');
    expect(systemOne).toHaveBeenCalledTimes(6);
  });

  it('gives a repeated query from the cache, with no Jev requests', async () => {
    const t = await setup(['a', 'c']);
    const { client, systemOne } = fakeClient();
    const cache = fakeCache();
    const first = await search({ db: t.db, client, cache })('Stormwater');
    const second = await search({ db: t.db, client, cache })('  stormwater ');
    expect(systemOne).toHaveBeenCalledTimes(2);
    expect(second.cached).toBe(true);
    expect(second.inputTokens).toBe(0);
    expect(second.hits.map((hit) => hit.item.id)).toEqual(first.hits.map((hit) => hit.item.id));
  });

  it('records spend, and stops at the daily cap', async () => {
    const t = await setup(['a']);
    const { client, systemOne } = fakeClient();
    await search({ db: t.db, client })('stormwater');
    const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Brisbane' });
    expect(await jevTokensOn(t.db)(day)).toBe(100);
    await addJevTokens(t.db)({ day, inputTokens: 1e9 });
    expect(await capReached(t.db)()).toBe(true);
    const capped = await search({ db: t.db, client })('stormwater');
    expect(capped.capped).toBe(true);
    expect(systemOne).toHaveBeenCalledTimes(1);
  });
});
