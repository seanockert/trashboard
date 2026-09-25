import { TypeSafeClient } from '@typesafe-ai/sdk';
import { ResultAsync } from 'neverthrow';
import type { StoredItem } from '../items';
import { closesQuestion, dateCandidates, penaltyCandidates, penaltyQuestion, selected, startsQuestion } from './candidates';
import { ENFORCEMENT_QUESTIONS, REGULATORY_QUESTIONS } from './questions';

// Pinned. An alias can change answers without warning.
const MODEL = 'jev-1.13.0';
export const USD_PER_MILLION_INPUT_TOKENS = 0.042;

export const makeClient = (apiKey: string) => new TypeSafeClient({ apiKey, defaultModel: MODEL });

type TagError = { type: 'jev_failed'; itemId: string; cause: unknown };

type Tagged = { itemId: string; answers: unknown; inputTokens: number; penaltyAud: number | null; closesOn: string | null; startsOn: string | null };

type Asked = Omit<Tagged, 'itemId'>;

// Jev does not see party group. Code decides it from the name.
const askEnforcement = async ({ client, item }: { client: TypeSafeClient; item: StoredItem }): Promise<Asked> => {
  const candidates = item.penaltySourceAud === null ? penaltyCandidates(item.body) : [];
  const state = {
    record: {
      regulator: item.sourceId,
      jurisdiction: item.jurisdiction,
      party: item.party,
      action: item.action,
      date: item.publishedAt,
      description: item.body || item.title,
      location: item.location,
    },
  };
  // No candidates: skip question.
  const questions = candidates.length === 0 ? ENFORCEMENT_QUESTIONS : { ...ENFORCEMENT_QUESTIONS, penalty: penaltyQuestion(candidates) };
  const res = await client.systemOne({ state, questions });
  return {
    answers: res.answers,
    inputTokens: res.usage.input_tokens,
    penaltyAud: 'penalty' in res.answers ? selected({ candidates, answer: res.answers.penalty }) : null,
    closesOn: null,
    startsOn: null,
  };
};

// Start date only for these types. Elsewhere often an event date.
const RULE_TYPES: ReadonlySet<string> = new Set(['law', 'bill', 'consultation', 'guidance', 'licence']);

const askRegulatory = async ({ client, item }: { client: TypeSafeClient; item: StoredItem }): Promise<Asked> => {
  const candidates = dateCandidates(`${item.title}\n${item.body}`, item.publishedAt);
  const state = { item: { source: item.sourceId, jurisdiction: item.jurisdiction, title: item.title, date: item.publishedAt, text: item.body } };
  const questions =
    candidates.length === 0 ? REGULATORY_QUESTIONS : { ...REGULATORY_QUESTIONS, closes: closesQuestion(candidates), starts: startsQuestion(candidates) };
  const res = await client.systemOne({ state, questions });
  const dates = 'closes' in res.answers ? { closes: res.answers.closes, starts: res.answers.starts } : null;
  return {
    answers: res.answers,
    inputTokens: res.usage.input_tokens,
    penaltyAud: null,
    closesOn: dates === null ? null : selected({ candidates, answer: dates.closes }),
    startsOn: dates !== null && RULE_TYPES.has(res.answers.itemType.choice) ? selected({ candidates, answer: dates.starts }) : null,
  };
};

export const tagItem =
  (client: TypeSafeClient) =>
  (item: StoredItem): ResultAsync<Tagged, TagError> =>
    ResultAsync.fromPromise(item.kind === 'regulatory' ? askRegulatory({ client, item }) : askEnforcement({ client, item }), (cause): TagError => ({
      type: 'jev_failed',
      itemId: item.id,
      cause,
    })).map((result) => ({ itemId: item.id, ...result }));
