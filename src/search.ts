import { noul, type TypeSafeClient } from '@typesafe-ai/sdk';
import { searchItems } from './db';
import type { StoredItem } from './items';
import { USD_PER_MILLION_INPUT_TOKENS } from './jev/tag';

const SHORTLIST = 30;
const RESULT_MIN = 0.3;
const WORDS_MAX = 12;
const EXCERPT = 700;

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

export type SearchResult = { hits: SearchHit[]; shortlist: number; inputTokens: number; costUsd: number; ms: number };

// One request per candidate, thus scores stay independent.
export const search =
  ({ db, client }: { db: D1Database; client: TypeSafeClient }) =>
  async (query: string): Promise<SearchResult> => {
    const started = Date.now();
    const match = ftsQuery(query);
    if (match === '') return { hits: [], shortlist: 0, inputTokens: 0, costUsd: 0, ms: 0 };
    const candidates = await searchItems(db)({ query: match, limit: SHORTLIST });
    const scored = await Promise.all(
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
    const inputTokens = scored.reduce((sum, s) => sum + s.tokens, 0);
    return {
      hits: scored
        .filter((s) => s.score >= RESULT_MIN)
        .toSorted((a, b) => b.score - a.score)
        .map(({ item, score, bm25Rank }) => ({ item, score, bm25Rank })),
      shortlist: candidates.length,
      inputTokens,
      costUsd: (inputTokens * USD_PER_MILLION_INPUT_TOKENS) / 1e6,
      ms: Date.now() - started,
    };
  };
