import { TypeSafeClient } from '@typesafe-ai/sdk';
import { ResultAsync } from 'neverthrow';
import { match } from 'ts-pattern';
import type { StoredItem } from '../items';
import { closesQuestion, dateCandidates, selectedDate, startsQuestion } from './dates';
import { penaltyCandidates, penaltyQuestion, selectedPenalty } from './penalty';
import { ENFORCEMENT_QUESTIONS, REGULATORY_QUESTIONS } from './questions';

// Pinned. An alias can change answers without warning.
export const MODEL = 'jev-1.13.0';
export const USD_PER_MILLION_INPUT_TOKENS = 0.042;

export const makeClient = (apiKey: string) => new TypeSafeClient({ apiKey, defaultModel: MODEL });

export type TagError = { type: 'jev_failed'; itemId: string; cause: unknown };

// `penaltyAud`, `closesOn` and `startsOn` are set only when Jev selected a value from the source text.
export type Tagged = { itemId: string; answers: unknown; inputTokens: number; penaltyAud: number | null; closesOn: string | null; startsOn: string | null };

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
    return { answers: res.answers, inputTokens: res.usage.input_tokens, penaltyAud: null, closesOn: null, startsOn: null };
  }
  const res = await client.systemOne({ state, questions: { ...ENFORCEMENT_QUESTIONS, penalty: penaltyQuestion(candidates) } });
  return {
    answers: res.answers,
    inputTokens: res.usage.input_tokens,
    penaltyAud: selectedPenalty({ candidates, answer: res.answers.penalty }),
    closesOn: null,
    startsOn: null,
  };
};

// A start date has a meaning only for these item types. In a news item or an enforcement report, it is often the date of an event.
const RULE_TYPES: ReadonlySet<string> = new Set(['law', 'bill', 'consultation', 'guidance', 'licence']);

const askRegulatory = async ({ client, item }: { client: TypeSafeClient; item: StoredItem }): Promise<Asked> => {
  const candidates = dateCandidates(`${item.title}\n${item.body}`, item.publishedAt);
  const state = regulatoryState(item);
  if (candidates.length === 0) {
    const res = await client.systemOne({ state, questions: REGULATORY_QUESTIONS });
    return { answers: res.answers, inputTokens: res.usage.input_tokens, penaltyAud: null, closesOn: null, startsOn: null };
  }
  const res = await client.systemOne({ state, questions: { ...REGULATORY_QUESTIONS, closes: closesQuestion(candidates), starts: startsQuestion(candidates) } });
  return {
    answers: res.answers,
    inputTokens: res.usage.input_tokens,
    penaltyAud: null,
    closesOn: selectedDate({ candidates, answer: res.answers.closes }),
    startsOn: RULE_TYPES.has(res.answers.itemType.choice) ? selectedDate({ candidates, answer: res.answers.starts }) : null,
  };
};

const ask = ({ client, item }: { client: TypeSafeClient; item: StoredItem }): Promise<Asked> =>
  match(item.kind)
    .with('regulatory', () => askRegulatory({ client, item }))
    .with('enforcement', () => askEnforcement({ client, item }))
    .exhaustive();

export const tagItem =
  (client: TypeSafeClient) =>
  (item: StoredItem): ResultAsync<Tagged, TagError> =>
    ResultAsync.fromPromise(ask({ client, item }), (cause): TagError => ({ type: 'jev_failed', itemId: item.id, cause })).map(
      (result) => ({ itemId: item.id, ...result }),
    );
