import { noul, type TypeSafeClient } from '@typesafe-ai/sdk';
import { z } from 'zod';
import { getItems, searchItems } from './db';
import type { StoredItem } from './items';
import { capReached, recordSpend } from './jev/spend';
import { USD_PER_MILLION_INPUT_TOKENS } from './jev/tag';

const SHORTLIST = 30;
const RESULT_MIN = 0.3;
const WORDS_MAX = 12;
const EXCERPT = 700;
// New items reach search in at most this time.
const CACHE_SECONDS = 3600;
// Change when the prompt or the scoring changes.
const CACHE_VERSION = 1;

// FTS5 syntax characters: quote each word.
const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 1)
    .slice(0, WORDS_MAX);

const ftsQuery = (text: string) =>
  words(text)
    .map((word) => `"${word}"`)
    .join(' OR ');

export const ftsFilter = (text: string) =>
  words(text)
    .map((word) => `"${word}"*`)
    .join(' ');

const helpsAnswer = noul(
  {
    question: 'Does `candidate` contain information that answers or directly helps with `query`?',
    context: 'The person who asks is the in-house legal counsel of an Australian waste management company.',
  },
  {
    true: 'The candidate is about the specific matter, conduct, law, party or place that the query asks about.',
    false: 'The candidate only shares some words or a general subject with the query.',
  },
);

type SearchHit = { item: StoredItem; score: number; bm25Rank: number };

export type SearchResult = {
  hits: SearchHit[];
  shortlist: number;
  // Candidates that Jev did not score. Results are then partial and not cached.
  failed: number;
  capped: boolean;
  cached: boolean;
  inputTokens: number;
  costUsd: number;
  ms: number;
};

const empty = { hits: [], shortlist: 0, failed: 0, capped: false, cached: false, inputTokens: 0, costUsd: 0, ms: 0 };

// Cache API: free, per Cloudflare location. Key uses the site origin.
export type SearchCache = { store: Cache; origin: string };

const Cached = z.object({ shortlist: z.number(), hits: z.array(z.object({ id: z.string(), score: z.number(), bm25Rank: z.number() })) });

const cacheKey = ({ origin, query }: { origin: string; query: string }) =>
  new Request(`${origin}/search-cache?${new URLSearchParams({ q: query.trim().toLowerCase().replace(/\s+/g, ' '), v: String(CACHE_VERSION) })}`);

const fromCache = async ({ db, cache, query }: { db: D1Database; cache: SearchCache; query: string }) => {
  const res = await cache.store.match(cacheKey({ origin: cache.origin, query }));
  if (res === undefined) return null;
  const parsed = Cached.safeParse(await res.json());
  if (!parsed.success) return null;
  const items = new Map((await getItems(db)(parsed.data.hits.map((hit) => hit.id))).map((item) => [item.id, item]));
  const hits = parsed.data.hits.flatMap(({ id, score, bm25Rank }) => {
    const item = items.get(id);
    return item === undefined ? [] : [{ item, score, bm25Rank }];
  });
  return { hits, shortlist: parsed.data.shortlist };
};

const toCache = ({ cache, query, hits, shortlist }: { cache: SearchCache; query: string; hits: SearchHit[]; shortlist: number }) =>
  cache.store.put(
    cacheKey({ origin: cache.origin, query }),
    new Response(JSON.stringify({ shortlist, hits: hits.map(({ item, score, bm25Rank }) => ({ id: item.id, score, bm25Rank })) }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${CACHE_SECONDS}` },
    }),
  );

// One request per candidate, thus scores stay independent. A failed request drops only its candidate.
export const search =
  ({ db, client, cache = null }: { db: D1Database; client: TypeSafeClient; cache?: SearchCache | null }) =>
  async (query: string): Promise<SearchResult> => {
    const started = Date.now();
    const match = ftsQuery(query);
    if (match === '') return empty;
    const hit = cache === null ? null : await fromCache({ db, cache, query });
    if (hit !== null) return { ...empty, ...hit, cached: true, ms: Date.now() - started };
    if (await capReached(db)()) return { ...empty, capped: true, ms: Date.now() - started };
    const candidates = await searchItems(db)({ query: match, limit: SHORTLIST });
    const settled = await Promise.allSettled(
      candidates.map(async (item, i) => {
        const res = await client.systemOne({
          state: {
            query,
            candidate: { title: item.title, jurisdiction: item.jurisdiction, date: item.publishedAt, party: item.party, text: item.body.slice(0, EXCERPT) },
          },
          questions: { helps: helpsAnswer },
        });
        return { item, score: res.answers.helps.noul, bm25Rank: i + 1, tokens: res.usage.input_tokens };
      }),
    );
    const scored = settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
    settled.forEach((result, i) => {
      if (result.status === 'rejected') console.error(JSON.stringify({ event: 'search_score_failed', itemId: candidates[i]?.id, error: String(result.reason) }));
    });
    const failed = settled.length - scored.length;
    const inputTokens = scored.reduce((sum, s) => sum + s.tokens, 0);
    await recordSpend(db)({ inputTokens });
    const hits = scored
      .filter((s) => s.score >= RESULT_MIN)
      .toSorted((a, b) => b.score - a.score)
      .map(({ item, score, bm25Rank }) => ({ item, score, bm25Rank }));
    if (cache !== null && failed === 0) await toCache({ cache, query, hits, shortlist: candidates.length });
    return {
      hits,
      shortlist: candidates.length,
      failed,
      capped: false,
      cached: false,
      inputTokens,
      costUsd: (inputTokens * USD_PER_MILLION_INPUT_TOKENS) / 1e6,
      ms: Date.now() - started,
    };
  };
