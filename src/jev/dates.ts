import { choice } from '@typesafe-ai/sdk';
import { dateMatches, yearlessDateMatches } from '../sources/dates';

// Code finds each date in the text. Jev selects the date that has a given
// meaning, thus a stored date is always a date that the source states.

const CONTEXT = 90;
export const DATE_MIN_CONFIDENCE = 0.6;
const MAX_CANDIDATES = 12;

export type DateCandidate = { key: string; date: string; excerpt: string };

// One candidate for each date. The first place in the text gives the context.
// `publishedAt` gives the year of a date with no year.
export const dateCandidates = (text: string, publishedAt: string | null = null): DateCandidate[] =>
  [...dateMatches(text), ...(publishedAt === null ? [] : yearlessDateMatches(text, publishedAt))]
    .filter((match, i, all) => all.findIndex((other) => other.date === match.date) === i)
    .slice(0, MAX_CANDIDATES)
    .map((match, i) => ({
      key: `date_${i + 1}`,
      date: match.date,
      excerpt: text.slice(Math.max(0, match.index - CONTEXT), match.index + match.length + CONTEXT).replace(/\s+/g, ' ').trim(),
    }));

const dateQuestion = ({ question, candidates }: { question: string; candidates: DateCandidate[] }) =>
  choice(
    { question },
    {
      ...Object.fromEntries(candidates.map((c) => [c.key, `The date ${c.date} in: "${c.excerpt}"`])),
      none: 'None of these dates has this meaning, or the item does not state this date.',
    },
  );

export const closesQuestion = (candidates: DateCandidate[]) =>
  dateQuestion({ question: 'Which date is the last day to make a submission or comment on `item`?', candidates });

export const startsQuestion = (candidates: DateCandidate[]) =>
  dateQuestion({
    question: 'Which date is the day when the law, rule, ban or requirement in `item` starts to apply to businesses? The date of publication or of a media release is not this date.',
    candidates,
  });

export const selectedDate = ({ candidates, answer }: { candidates: DateCandidate[]; answer: { choice: string; confidence: number } }) =>
  answer.confidence < DATE_MIN_CONFIDENCE ? null : (candidates.find((c) => c.key === answer.choice)?.date ?? null);
