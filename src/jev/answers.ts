import { z } from 'zod';
import { ENFORCEMENT_QUESTIONS, REGULATORY_QUESTIONS } from './questions';

// Stored answers come back from D1 as JSON text. These schemas check them.

const Noul = z.object({ type: z.literal('noul'), noul: z.number() });
const Score = z.object({ type: z.literal('score'), score: z.number(), confidence: z.number(), probabilities: z.record(z.string(), z.number()) });
const Choice = <const T extends readonly [string, ...string[]]>(options: T) =>
  z.object({
    type: z.literal('choice'),
    choice: z.enum(options),
    confidence: z.number(),
    probabilities: z.record(z.string(), z.number()),
  });

const keysOf = <T extends Record<string, unknown>>(criteria: T) => {
  const [first, ...rest] = Object.keys(criteria);
  if (first === undefined) throw new Error('A Choice needs at least one option.');
  return [first, ...rest] as const;
};

export const ITEM_TYPES = keysOf(REGULATORY_QUESTIONS.itemType.criteria);
export const OFFENCES = keysOf(ENFORCEMENT_QUESTIONS.offence.criteria);

export const LINES_OF_BUSINESS = ['lobCollection', 'lobRecycling', 'lobLiquidHazardous', 'lobLandfill', 'lobFleet'] as const;
export const TOPICS = [
  'topicLevy',
  'topicLicensing',
  'topicPollution',
  'topicContaminants',
  'topicStewardship',
  'topicPackaging',
  'topicEmissions',
  'topicPlanning',
  'topicSafety',
] as const;

export const RegulatoryAnswers = z.object({
  wasteFocus: Score,
  impact: Score,
  itemType: Choice(ITEM_TYPES),
  actionRequired: Noul,
  submissionsOpen: Noul,
  lobCollection: Noul,
  lobRecycling: Noul,
  lobLiquidHazardous: Noul,
  lobLandfill: Noul,
  lobFleet: Noul,
  topicLevy: Noul,
  topicLicensing: Noul,
  topicPollution: Noul,
  topicContaminants: Noul,
  topicStewardship: Noul,
  topicPackaging: Noul,
  topicEmissions: Noul,
  topicPlanning: Noul,
  topicSafety: Noul,
});
export type RegulatoryAnswers = z.infer<typeof RegulatoryAnswers>;

export const EnforcementAnswers = z.object({
  wasteOperator: Noul,
  offence: Choice(OFFENCES),
  severity: Score,
  similarRisk: Noul,
});
export type EnforcementAnswers = z.infer<typeof EnforcementAnswers>;
