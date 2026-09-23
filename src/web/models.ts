import { z } from 'zod';
import { EnforcementAnswers, LINES_OF_BUSINESS, OFFENCES, RegulatoryAnswers, TOPICS } from '../jev/answers';
import { Jurisdiction, type StoredItem } from '../items';
import { PARTY_GROUPS } from '../parties';
import { FLAG_MIN, PRIORITY_HIGH, PRIORITY_MEDIUM, type FlagKey } from '../rank';

export const PAGE_SIZE = 50;

export const LOB_LABELS: Record<(typeof LINES_OF_BUSINESS)[number], string> = {
  lobCollection: 'Collection',
  lobRecycling: 'Recycling and organics',
  lobLiquidHazardous: 'Liquid and hazardous',
  lobLandfill: 'Landfill and transfer',
  lobFleet: 'Fleet',
};

export const TOPIC_LABELS: Record<(typeof TOPICS)[number], string> = {
  topicLevy: 'Waste levy',
  topicLicensing: 'Licensing',
  topicPollution: 'Pollution',
  topicContaminants: 'PFAS and contaminants',
  topicStewardship: 'Batteries and stewardship',
  topicPackaging: 'Packaging',
  topicEmissions: 'Emissions',
  topicPlanning: 'Planning',
  topicSafety: 'Safety and fire',
};

export const OFFENCE_LABELS: Record<string, string> = {
  water: 'Water pollution',
  air: 'Air, odour, dust',
  noise: 'Noise',
  dumping: 'Illegal dumping',
  storage: 'Stockpiles and storage',
  licence: 'Licence condition',
  reporting: 'Records and reporting',
  notification: 'Late notification',
  fire: 'Fire',
  contamination: 'Contamination',
  transport: 'Transport and tracking',
  levy: 'Waste levy',
  other: 'Other',
  unknown: 'Not stated',
};

const optional = <T extends z.ZodType>(schema: T) => z.preprocess((value) => (value === '' ? undefined : value), schema.optional());
const page = optional(z.coerce.number().int().min(1).max(1000)).default(1);

export const ChangesFilters = z.object({
  days: optional(z.coerce.number().int().min(1).max(3650)).default(90),
  jurisdiction: optional(Jurisdiction),
  lob: optional(z.enum(LINES_OF_BUSINESS)),
  topic: optional(z.enum(TOPICS)),
  need: optional(z.enum(['action', 'submissions'])),
  all: optional(z.literal('1')),
  page,
});
export type ChangesFilters = z.infer<typeof ChangesFilters>;

export const changesFlags = (f: ChangesFilters): FlagKey[] => [
  ...(f.lob === undefined ? [] : [f.lob]),
  ...(f.topic === undefined ? [] : [f.topic]),
  ...(f.need === 'action' ? ['actionRequired' as const] : []),
  ...(f.need === 'submissions' ? ['submissionsOpen' as const] : []),
];

export const EnforcementFilters = z.object({
  days: optional(z.coerce.number().int().min(1).max(9000)).default(1825),
  jurisdiction: optional(Jurisdiction),
  group: optional(z.enum([...PARTY_GROUPS.map((g) => g.id), 'other'])),
  offence: optional(z.enum(OFFENCES)),
  industry: optional(z.enum(['waste', 'all'])).default('waste'),
  page,
});
export type EnforcementFilters = z.infer<typeof EnforcementFilters>;

// Legislation feeds give only a label and the title, for example "Act: <title>".
// A body with less than this much text beside the title adds nothing to the card.
const SNIPPET_MIN_EXTRA = 40;

export const snippet = (item: StoredItem) =>
  item.body.includes(item.title) && item.body.length - item.title.length < SNIPPET_MIN_EXTRA ? '' : item.body;

export const sinceDate = (days: number, now: Date) => new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);

export type Tag<K extends string = string> = { key: K; label: string };
export type PriorityLevel = 'high' | 'medium' | 'low';

export type ChangeRow = {
  item: StoredItem;
  answers: RegulatoryAnswers;
  priority: number;
  level: PriorityLevel;
  reasons: string[];
  lines: Tag<(typeof LINES_OF_BUSINESS)[number]>[];
  topics: Tag<(typeof TOPICS)[number]>[];
};
export type EnforcementRow = { item: StoredItem; answers: EnforcementAnswers };

const flagged = <K extends string>({ answers, keys, labels }: { answers: Record<K, { noul: number }>; keys: readonly K[]; labels: Record<K, string> }): Tag<K>[] =>
  keys.filter((key) => answers[key].noul >= FLAG_MIN).map((key) => ({ key, label: labels[key] }));

export const priorityLevel = (priority: number): PriorityLevel =>
  priority >= PRIORITY_HIGH ? 'high' : priority >= PRIORITY_MEDIUM ? 'medium' : 'low';

// Short text for each level of the `wasteFocus` and `impact` Scores in src/jev/questions.ts.
const FOCUS_REASONS = ['Not about waste', 'General business rule', 'Environment rule', 'About waste'];
const IMPACT_REASONS = ['No effect on operations', 'Background only', 'Small admin change', 'Compliance change', 'Large cost or operations change'];

// Why an item has its priority, from the Jev answers that make the priority.
export const priorityReasons = (answers: RegulatoryAnswers): string[] => {
  const focus = Object.entries(answers.wasteFocus.probabilities).toSorted((a, b) => b[1] - a[1])[0]?.[0];
  return [FOCUS_REASONS[Number(focus)], IMPACT_REASONS[Math.round(answers.impact.score)]].filter((text) => text !== undefined);
};

// Only the rows on the page are parsed. D1 did the filters, the sort and the counts.
export const toChangeRows = (rows: { item: StoredItem; priority: number }[]): ChangeRow[] =>
  rows.flatMap(({ item, priority }) => {
    const parsed = RegulatoryAnswers.safeParse(item.answers);
    if (!parsed.success) return [];
    return [
      {
        item,
        priority,
        answers: parsed.data,
        level: priorityLevel(priority),
        reasons: priorityReasons(parsed.data),
        lines: flagged({ answers: parsed.data, keys: LINES_OF_BUSINESS, labels: LOB_LABELS }),
        topics: flagged({ answers: parsed.data, keys: TOPICS, labels: TOPIC_LABELS }),
      },
    ];
  });

export const toEnforcementRows = (items: StoredItem[]): EnforcementRow[] =>
  items.flatMap((item) => {
    const parsed = EnforcementAnswers.safeParse(item.answers);
    return parsed.success ? [{ item, answers: parsed.data }] : [];
  });

export const groupTable = (rows: { grp: string; n: number; penalty: number | null; serious: number }[]) =>
  [...PARTY_GROUPS.map((g) => ({ id: g.id, label: g.label })), { id: 'other', label: 'Other waste operators' }]
    .map((group) => {
      const row = rows.find((r) => r.grp === group.id);
      return { ...group, count: row?.n ?? 0, penaltyTotal: row?.penalty ?? 0, serious: row?.serious ?? 0 };
    })
    .filter((group) => group.count > 0 || group.id === 'jjr');

export const offenceChips = (rows: { offence: string | null; n: number }[]) =>
  Object.entries(OFFENCE_LABELS).flatMap(([id, label]) => {
    const n = rows.find((r) => r.offence === id)?.n ?? 0;
    return n > 0 ? [{ id, label, count: n }] : [];
  });
