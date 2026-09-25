import { choice } from '@typesafe-ai/sdk';
import { dollarAmounts, uniqueBy } from '../sources/common';
import { dateMatches, yearlessDateMatches } from '../sources/dates';

// Code finds values, Jev only selects one. Stored value is always from source.

const CONTEXT = 90;
const MAX_CANDIDATES = 12;
const MIN_CONFIDENCE = 0.6;

type Candidate<V> = { key: string; value: V; excerpt: string };

type Match<V> = { value: V; index: number; length: number };

const candidatesOf = <V>({ text, matches, prefix }: { text: string; matches: Match<V>[]; prefix: string }): Candidate<V>[] =>
  matches.slice(0, MAX_CANDIDATES).map((m, i) => ({
    key: `${prefix}_${i + 1}`,
    value: m.value,
    excerpt: text.slice(Math.max(0, m.index - CONTEXT), m.index + m.length + CONTEXT).replace(/\s+/g, ' ').trim(),
  }));

const candidateQuestion = <V>({ question, candidates, describe, none }: { question: string; candidates: Candidate<V>[]; describe: (value: V) => string; none: string }) =>
  choice({ question }, { ...Object.fromEntries(candidates.map((c) => [c.key, `${describe(c.value)} in: "${c.excerpt}"`])), none });

export const selected = <V>({ candidates, answer }: { candidates: Candidate<V>[]; answer: { choice: string; confidence: number } }) =>
  answer.confidence < MIN_CONFIDENCE ? null : (candidates.find((c) => c.key === answer.choice)?.value ?? null);

// `publishedAt` gives year when date has none.
export const dateCandidates = (text: string, publishedAt: string | null = null) => {
  const all = [...dateMatches(text), ...(publishedAt === null ? [] : yearlessDateMatches(text, publishedAt))];
  return candidatesOf({ text, matches: uniqueBy(all, (m) => m.date).map((m) => ({ ...m, value: m.date })), prefix: 'date' });
};

const dateQuestion = (question: string, candidates: Candidate<string>[]) =>
  candidateQuestion({ question, candidates, describe: (date) => `The date ${date}`, none: 'None of these dates has this meaning, or the item does not state this date.' });

export const closesQuestion = (candidates: Candidate<string>[]) => dateQuestion('Which date is the last day to make a submission or comment on `item`?', candidates);

export const startsQuestion = (candidates: Candidate<string>[]) =>
  dateQuestion(
    'Which date is the day when the law, rule, ban or requirement in `item` starts to apply to businesses? The date of publication or of a media release is not this date.',
    candidates,
  );

export const penaltyCandidates = (text: string) =>
  candidatesOf({ text, matches: dollarAmounts(text).map((m) => ({ ...m, value: m.amount })), prefix: 'amount' });

export const penaltyQuestion = (candidates: Candidate<number>[]) =>
  candidateQuestion({
    question:
      'Which amount is the total fine or monetary penalty that the party in `record` was ordered or agreed to pay? Costs, clean-up spending and maximum penalties are not the penalty.',
    candidates,
    describe: (amount) => `The amount $${amount.toLocaleString('en-AU')}`,
    none: 'None of these amounts is the penalty, or the record states no penalty.',
  });
