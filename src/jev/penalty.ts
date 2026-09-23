import { choice } from '@typesafe-ai/sdk';

// Code finds each dollar amount in the text. Jev selects the one that is the
// penalty, thus the stored amount is always a number that the source states.

const CONTEXT = 90;
export const PENALTY_MIN_CONFIDENCE = 0.6;
const MAX_CANDIDATES = 12;

export type PenaltyCandidate = { key: string; amount: number; excerpt: string };

export const penaltyCandidates = (text: string): PenaltyCandidate[] =>
  [...text.matchAll(/\$\s?([\d,]+(?:\.\d{2})?)/g)].slice(0, MAX_CANDIDATES).map((m, i) => {
    const at = m.index;
    return {
      key: `amount_${i + 1}`,
      amount: Number((m[1] ?? '').replace(/,/g, '')),
      excerpt: text.slice(Math.max(0, at - CONTEXT), at + m[0].length + CONTEXT).replace(/\s+/g, ' ').trim(),
    };
  });

export const penaltyQuestion = (candidates: PenaltyCandidate[]) =>
  choice(
    {
      question:
        'Which amount is the total fine or monetary penalty that the party in `record` was ordered or agreed to pay? Costs, clean-up spending and maximum penalties are not the penalty.',
    },
    {
      ...Object.fromEntries(candidates.map((c) => [c.key, `The amount ${'$'}${c.amount.toLocaleString('en-AU')} in: "${c.excerpt}"`])),
      none: 'None of these amounts is the penalty, or the record states no penalty.',
    },
  );

export const selectedPenalty = ({
  candidates,
  answer,
}: {
  candidates: PenaltyCandidate[];
  answer: { choice: string; confidence: number };
}) => (answer.confidence < PENALTY_MIN_CONFIDENCE ? null : (candidates.find((c) => c.key === answer.choice)?.amount ?? null));
