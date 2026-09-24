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
  safety: 'Work health and safety',
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
  company: optional(z.enum([...PARTY_GROUPS.map((g) => g.id), 'any'])),
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

// The user is in Brisbane. A day in UTC starts at 10:00 there, thus each day on a page is a Brisbane day.
export const brisbaneDay = (date: Date) => date.toLocaleDateString('en-CA', { timeZone: 'Australia/Brisbane' });

export const sinceDate = (days: number, now: Date) => brisbaneDay(new Date(now.getTime() - days * 86_400_000));

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
  const focusReason = answers.fleetRule.noul >= FLAG_MIN && Number(focus) < 2 ? 'Rule for your trucks' : FOCUS_REASONS[Number(focus)];
  return [focusReason, IMPACT_REASONS[Math.round(answers.impact.score)]].filter((text) => text !== undefined);
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

export type PenaltyBenchmark = { id: string; label: string; count: number; median: number; highest: number };

const median = (sorted: number[]) => {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
};

// The known penalties for each type of conduct, most records first.
export const penaltyBenchmarks = (rows: { offence: string | null; penalty: number }[]): PenaltyBenchmark[] =>
  Object.entries(Object.groupBy(rows, (r) => r.offence ?? 'unknown'))
    .flatMap(([id, group]) => {
      const amounts = (group ?? []).map((r) => r.penalty).toSorted((a, b) => a - b);
      return amounts.length === 0 ? [] : [{ id, label: OFFENCE_LABELS[id] ?? id, count: amounts.length, median: median(amounts), highest: amounts.at(-1) ?? 0 }];
    })
    .toSorted((a, b) => b.count - a.count || b.highest - a.highest);

export type DateEntry = { date: string; type: 'closes' | 'starts'; row: ChangeRow };

// One entry for each date in the range. An item with two dates gives two entries.
export const dateEntries = ({ rows, from, to }: { rows: ChangeRow[]; from: string; to: string }): DateEntry[] =>
  rows
    .flatMap((row) => [
      ...(row.item.closesOn === null ? [] : [{ date: row.item.closesOn, type: 'closes' as const, row }]),
      ...(row.item.startsOn === null ? [] : [{ date: row.item.startsOn, type: 'starts' as const, row }]),
    ])
    .filter((entry) => entry.date >= from && entry.date <= to)
    .toSorted((a, b) => a.date.localeCompare(b.date) || b.row.priority - a.row.priority);

export const Quarter = z.string().regex(/^\d{4}-Q[1-4]$/);

const QUARTER_MONTHS = ['January to March', 'April to June', 'July to September', 'October to December'];

export const quarterOf = (date: Date) => {
  const day = brisbaneDay(date);
  return `${day.slice(0, 4)}-Q${Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1}`;
};

export const quarterRange = (quarter: string) => {
  const year = Number(quarter.slice(0, 4));
  const q = Number(quarter.slice(-1));
  const from = new Date(Date.UTC(year, (q - 1) * 3, 1));
  const to = new Date(Date.UTC(year, q * 3, 0));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), label: `${QUARTER_MONTHS[q - 1]} ${year}` };
};

// The current quarter and the ones before it, newest first.
// Day 15 of a month is the same month in UTC and in Brisbane.
export const recentQuarters = (now: Date, count: number) => {
  const day = brisbaneDay(now);
  const [year, month] = [Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1];
  return Array.from({ length: count }, (_, i) => quarterOf(new Date(Date.UTC(year, month - 3 * i, 15))));
};

export type BandStat = { band: 'high' | 'medium' | 'low' | 'hidden'; count: number; useful: number; types: { type: string; count: number; useful: number }[] };

// Labels by priority band. The types show which kinds of item make a band less precise.
export const bandStats = (rows: { band: BandStat['band']; type: string | null; n: number; useful: number }[]): BandStat[] =>
  (['high', 'medium', 'low', 'hidden'] as const).map((band) => {
    const types = rows
      .filter((r) => r.band === band)
      .map((r) => ({ type: r.type ?? 'unknown', count: r.n, useful: r.useful }))
      .toSorted((a, b) => b.count - a.count);
    return { band, count: types.reduce((sum, t) => sum + t.count, 0), useful: types.reduce((sum, t) => sum + t.useful, 0), types };
  });
