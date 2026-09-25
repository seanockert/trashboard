import { z } from 'zod';
import { EnforcementAnswers, ITEM_TYPES, LINES_OF_BUSINESS, RegulatoryAnswers, TOPICS } from '../jev/answers';
import { Jurisdiction, type StoredItem, type Triage } from '../items';
import { PARTY_GROUPS } from '../parties';
import { FLAG_MIN, PRIORITY_HIGH, PRIORITY_LEVELS, PRIORITY_MEDIUM, type PriorityLevel } from '../rank';
import { SORTS, type InboxRow, type Period, type Scope, type Sort } from '../db';
import { ftsFilter } from '../search';
import { omniField, parseOmni, formatOmni } from './omnibar';

export const PAGE_SIZE = 50;

const TOPIC_KEYS = [...LINES_OF_BUSINESS, ...TOPICS] as const;
type TopicKey = (typeof TOPIC_KEYS)[number];

const TOPIC_OPTIONS: Record<TopicKey, { token: string; label: string }> = {
  lobCollection: { token: 'collection', label: 'Collection' },
  lobRecycling: { token: 'recycling', label: 'Recycling and organics' },
  lobLiquidHazardous: { token: 'hazardous', label: 'Liquid and hazardous' },
  lobLandfill: { token: 'landfill', label: 'Landfill and transfer' },
  lobFleet: { token: 'fleet', label: 'Fleet' },
  topicLevy: { token: 'levy', label: 'Waste levy' },
  topicLicensing: { token: 'licensing', label: 'Licensing' },
  topicPollution: { token: 'pollution', label: 'Pollution' },
  topicContaminants: { token: 'pfas', label: 'PFAS and contaminants' },
  topicStewardship: { token: 'stewardship', label: 'Batteries and stewardship' },
  topicPackaging: { token: 'packaging', label: 'Packaging' },
  topicEmissions: { token: 'emissions', label: 'Emissions' },
  topicPlanning: { token: 'planning', label: 'Planning' },
  topicSafety: { token: 'safety', label: 'Safety and fire' },
};

export const ITEM_TYPE_LABELS: Record<(typeof ITEM_TYPES)[number], string> = {
  law: 'Law',
  bill: 'Bill',
  consultation: 'Consultation',
  guidance: 'Guidance',
  licence: 'Licence',
  enforcement: 'Enforcement',
  news: 'News',
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

// User is in Brisbane (UTC+10). Each day is a Brisbane day.
export const brisbaneDay = (date: Date) => date.toLocaleDateString('en-CA', { timeZone: 'Australia/Brisbane' });

export const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);

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

// Day 15 is the same month in UTC and Brisbane.
export const recentQuarters = (now: Date, count: number) => {
  const day = brisbaneDay(now);
  const [year, month] = [Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1];
  return Array.from({ length: count }, (_, i) => quarterOf(new Date(Date.UTC(year, month - 3 * i, 15))));
};

const RECENT_PERIODS = [
  { token: '7d', label: 'Last 7 days', days: 7 },
  { token: '30d', label: 'Last 30 days', days: 30 },
  { token: '90d', label: 'Last 90 days', days: 90 },
  { token: '12m', label: 'Last 12 months', days: 365 },
  { token: '5y', label: 'Last 5 years', days: 1825 },
];

const ALL_TIME = { token: 'all', label: 'All time' };

const QUARTERS_SHOWN = 8;

export const DEFAULT_PERIOD = '90d';

export const periodRange = (token: string, now: Date): Period & { label: string } => {
  const recent = RECENT_PERIODS.find((p) => p.token === token);
  if (recent !== undefined) return { from: brisbaneDay(addDays(now, -recent.days)), to: brisbaneDay(now), label: recent.label };
  if (token === ALL_TIME.token) return { from: '0000-01-01', to: brisbaneDay(now), label: ALL_TIME.label };
  return quarterRange(token);
};

export const PRIORITY_LEVEL_LABELS: Record<PriorityLevel, string> = { high: 'High', medium: 'Medium', low: 'Low' };

export const inboxFields = (now: Date) => ({
  period: omniField('period', 'Period', [
    ...[...RECENT_PERIODS, ALL_TIME].map(({ token, label }) => ({ token, label, value: token })),
    ...recentQuarters(now, QUARTERS_SHOWN).map((q) => ({ token: q, label: quarterRange(q).label, value: q })),
  ]),
  jurisdiction: omniField('jurisdiction', 'Jurisdiction', Jurisdiction.options.map((j) => ({ token: j, label: j, value: j }))),
  topic: omniField('topic', 'Topic', TOPIC_KEYS.map((key) => ({ ...TOPIC_OPTIONS[key], value: key }))),
  type: omniField('type', 'Type', ITEM_TYPES.map((key) => ({ token: key, label: ITEM_TYPE_LABELS[key] ?? key, value: key }))),
  company: omniField('company', 'Company named', [...PARTY_GROUPS.map((g) => ({ token: g.id, label: g.label, value: g.id })), { token: 'any', label: 'Any listed company', value: 'any' }]),
  priority: omniField('priority', 'Priority', PRIORITY_LEVELS.map((level) => ({ token: level, label: PRIORITY_LEVEL_LABELS[level], value: level }))),
});
export type InboxFields = ReturnType<typeof inboxFields>;

const optional = <T extends z.ZodType>(schema: T) => z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

const InboxParams = z.object({
  q: z.string().catch('').transform((text) => text.slice(0, 300)),
  tab: z.enum(['new', 'acting', 'done']).catch('new'),
  view: optional(z.literal('report')).catch(undefined),
  sort: optional(z.enum(SORTS)).catch(undefined),
  page: optional(z.coerce.number().int().min(1).max(1000)).default(1).catch(1),
});

// New tab default period = no period. Keep it out of URL and other tabs.
export const parseInboxFilters = (params: Record<string, string>, now: Date) => {
  const { q, ...rest } = InboxParams.parse(params);
  const omni = parseOmni(inboxFields(now), q);
  const isDefault = rest.tab === 'new' && rest.view === undefined && omni.picked.period === DEFAULT_PERIOD;
  return { ...omni, picked: { ...omni.picked, period: isDefault ? undefined : omni.picked.period }, ...rest };
};
export type InboxFilters = ReturnType<typeof parseInboxFilters>;

export const shownFilters = (f: InboxFilters): InboxFilters =>
  f.tab === 'new' && f.view === undefined && f.picked.period === undefined ? { ...f, picked: { ...f.picked, period: DEFAULT_PERIOD } } : f;

export const inboxParams = (f: InboxFilters, fields: InboxFields) => ({
  q: formatOmni(fields, f),
  tab: f.tab === 'new' ? undefined : f.tab,
  view: f.view,
  sort: f.sort,
  page: f.page > 1 ? f.page : undefined,
});

export const sortOf = (f: Pick<InboxFilters, 'tab' | 'sort'>): Sort => {
  const sort = f.sort ?? (f.tab === 'done' ? 'triaged' : 'priority');
  return f.tab === 'new' && sort === 'triaged' ? 'priority' : sort;
};

export const scopeOf = (f: InboxFilters, now: Date, version: number): Scope => ({
  version,
  period: f.picked.period === undefined ? undefined : periodRange(f.picked.period, now),
  jurisdiction: f.picked.jurisdiction,
  company: f.picked.company,
  topic: f.picked.topic,
  type: f.picked.type,
  priority: f.picked.priority,
  match: ftsFilter(f.text),
});

// Feeds often give only label + title. Less body text than this adds nothing.
const SNIPPET_MIN_EXTRA = 40;

export const snippet = (item: StoredItem) =>
  item.body.includes(item.title) && item.body.length - item.title.length < SNIPPET_MIN_EXTRA ? '' : item.body;

type Tag<K extends string = string> = { key: K; label: string };

type RowBase = { item: StoredItem; priority: number; level: PriorityLevel; reasons: string[]; triage: Triage | null };
export type Row = (RowBase & { kind: 'regulatory'; answers: RegulatoryAnswers; topics: Tag<TopicKey>[] }) | (RowBase & { kind: 'enforcement'; answers: EnforcementAnswers });

const priorityLevel = (priority: number): PriorityLevel =>
  priority >= PRIORITY_HIGH ? 'high' : priority >= PRIORITY_MEDIUM ? 'medium' : 'low';

// Level 3 (waste) is most items: no text.
const FOCUS_REASONS = ['Not waste', 'General rule', 'Environment rule'];
const IMPACT_REASONS = ['No effect', 'Background', 'Minor admin', 'Compliance change', 'Major cost'];
const SEVERITY_REASONS = ['Admin', 'Minor breach', 'Harm risk', 'Serious harm'];

const priorityReasons = (answers: RegulatoryAnswers): string[] => {
  const focus = Object.entries(answers.wasteFocus.probabilities).toSorted((a, b) => b[1] - a[1])[0]?.[0];
  const focusReason = answers.fleetRule.noul >= FLAG_MIN && Number(focus) < 2 ? 'Fleet rule' : FOCUS_REASONS[Number(focus)];
  return [focusReason, IMPACT_REASONS[Math.round(answers.impact.score)]].filter((text) => text !== undefined);
};

const enforcementReasons = (answers: EnforcementAnswers): string[] =>
  [SEVERITY_REASONS[Math.round(answers.severity.score)]].filter((text) => text !== undefined);

// D1 did filters, sort, counts. Parse only page rows.
export const toRows = (rows: InboxRow[]): Row[] =>
  rows.flatMap(({ item, priority, triage }): Row[] => {
    const base = { item, priority, triage, level: priorityLevel(priority) };
    if (item.kind === 'enforcement') {
      const parsed = EnforcementAnswers.safeParse(item.answers);
      return parsed.success ? [{ ...base, kind: 'enforcement', answers: parsed.data, reasons: enforcementReasons(parsed.data) }] : [];
    }
    const parsed = RegulatoryAnswers.safeParse(item.answers);
    if (!parsed.success) return [];
    const topics = TOPIC_KEYS.filter((key) => parsed.data[key].noul >= FLAG_MIN).map((key) => ({ key, label: TOPIC_OPTIONS[key].label }));
    return [{ ...base, kind: 'regulatory', answers: parsed.data, reasons: priorityReasons(parsed.data), topics }];
  });

export const groupTable = (rows: { grp: string; n: number; penalty: number | null; serious: number }[]) =>
  [...PARTY_GROUPS.map((g) => ({ id: g.id, label: g.label })), { id: 'other', label: 'Other waste operators' }]
    .map((group) => {
      const row = rows.find((r) => r.grp === group.id);
      return { ...group, count: row?.n ?? 0, penaltyTotal: row?.penalty ?? 0, serious: row?.serious ?? 0 };
    })
    .filter((group) => group.count > 0 || group.id === 'jjr');

export type PenaltyBenchmark = { id: string; label: string; count: number; median: number; highest: number };

const median = (sorted: number[]) => {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
};

export const penaltyBenchmarks = (rows: { offence: string | null; penalty: number }[]): PenaltyBenchmark[] =>
  Object.entries(Object.groupBy(rows, (r) => r.offence ?? 'unknown'))
    .flatMap(([id, group]) => {
      const amounts = (group ?? []).map((r) => r.penalty).toSorted((a, b) => a - b);
      return amounts.length === 0 ? [] : [{ id, label: OFFENCE_LABELS[id] ?? id, count: amounts.length, median: median(amounts), highest: amounts.at(-1) ?? 0 }];
    })
    .toSorted((a, b) => b.count - a.count || b.highest - a.highest);

export const hitPenalties = (items: StoredItem[]) =>
  items.flatMap((item) => {
    if (item.kind !== 'enforcement' || item.penaltyAud === null) return [];
    const parsed = EnforcementAnswers.safeParse(item.answers);
    return [{ offence: parsed.success ? parsed.data.offence.choice : null, penalty: item.penaltyAud }];
  });

export type DateEntry = { date: string; type: 'closes' | 'starts'; row: Row };

export const dateEntries = ({ rows, from, to }: { rows: Row[]; from: string; to: string }): DateEntry[] =>
  rows
    .flatMap((row) => [
      ...(row.item.closesOn === null ? [] : [{ date: row.item.closesOn, type: 'closes' as const, row }]),
      ...(row.item.startsOn === null ? [] : [{ date: row.item.startsOn, type: 'starts' as const, row }]),
    ])
    .filter((entry) => entry.date >= from && entry.date <= to)
    .toSorted((a, b) => a.date.localeCompare(b.date) || b.row.priority - a.row.priority);
