import { TypeSafeClient } from '@typesafe-ai/sdk';
import { ResultAsync } from 'neverthrow';
import { match } from 'ts-pattern';
import type { StoredItem } from '../items';
import { penaltyCandidates, penaltyQuestion, selectedPenalty } from './penalty';
import { ENFORCEMENT_QUESTIONS, REGULATORY_QUESTIONS } from './questions';

// Pinned. An alias can change answers without warning.
export const MODEL = 'jev-1.13.0';
export const USD_PER_MILLION_INPUT_TOKENS = 0.042;

export const makeClient = (apiKey: string) => new TypeSafeClient({ apiKey, defaultModel: MODEL });

export type TagError = { type: 'jev_failed'; itemId: string; cause: unknown };

// `penaltyAud` is set only when Jev selected an amount from the source text.
export type Tagged = { itemId: string; answers: unknown; inputTokens: number; penaltyAud: number | null };

// Jev sees the source text and the facts from the source. It does not see
// the party group, because code decides that from the name.
const regulatoryState = (item: StoredItem) => ({
  item: {
    source: item.sourceId,
    jurisdiction: item.jurisdiction,
    title: item.title,
    date: item.publishedAt,
    text: item.body,
  },
});

const enforcementState = (item: StoredItem) => ({
  record: {
    regulator: item.sourceId,
    jurisdiction: item.jurisdiction,
    party: item.party,
    action: item.action,
    date: item.publishedAt,
    description: item.body || item.title,
    location: item.location,
  },
});

type Asked = Omit<Tagged, 'itemId'>;

const askEnforcement = async ({ client, item }: { client: TypeSafeClient; item: StoredItem }): Promise<Asked> => {
  const candidates = item.penaltyAud === null ? penaltyCandidates(item.body) : [];
  const state = enforcementState(item);
  if (candidates.length === 0) {
    const res = await client.systemOne({ state, questions: ENFORCEMENT_QUESTIONS });
    return { answers: res.answers, inputTokens: res.usage.input_tokens, penaltyAud: null };
  }
  const res = await client.systemOne({ state, questions: { ...ENFORCEMENT_QUESTIONS, penalty: penaltyQuestion(candidates) } });
  return {
    answers: res.answers,
    inputTokens: res.usage.input_tokens,
    penaltyAud: selectedPenalty({ candidates, answer: res.answers.penalty }),
  };
};

const ask = ({ client, item }: { client: TypeSafeClient; item: StoredItem }): Promise<Asked> =>
  match(item.kind)
    .with('regulatory', () =>
      client.systemOne({ state: regulatoryState(item), questions: REGULATORY_QUESTIONS }).then((res): Asked => ({
        answers: res.answers,
        inputTokens: res.usage.input_tokens,
        penaltyAud: null,
      })),
    )
    .with('enforcement', () => askEnforcement({ client, item }))
    .exhaustive();

export const tagItem =
  (client: TypeSafeClient) =>
  (item: StoredItem): ResultAsync<Tagged, TagError> =>
    ResultAsync.fromPromise(ask({ client, item }), (cause): TagError => ({ type: 'jev_failed', itemId: item.id, cause })).map(
      (result) => ({ itemId: item.id, ...result }),
    );
