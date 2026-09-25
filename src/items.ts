import { z } from 'zod';
import type { Summary } from './summary';

export const Jurisdiction = z.enum(['CTH', 'QLD', 'NSW', 'VIC', 'SA', 'WA', 'TAS', 'NT', 'ACT']);
export type Jurisdiction = z.infer<typeof Jurisdiction>;

export const TriageStatus = z.enum(['acting', 'done', 'dismissed']);
export type TriageStatus = z.infer<typeof TriageStatus>;
export type Triage = { status: TriageStatus; note: string };

// Jev accuracy drops when state holds much irrelevant text.
export const BODY_MAX = 4000;

const common = {
  externalId: z.string().min(1),
  jurisdiction: Jurisdiction,
  title: z.string().min(1),
  url: z.url({ protocol: /^https?$/ }),
  publishedAt: z.iso.date().nullable(),
  body: z.string().transform((text) => text.slice(0, BODY_MAX)),
  detailUrl: z.url({ protocol: /^https?$/ }).nullable().default(null),
};

export const NewItem = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('regulatory'), ...common }),
  z.object({
    kind: z.literal('enforcement'),
    ...common,
    party: z.string().min(1),
    action: z.string().min(1),
    location: z.string().nullable(),
    penaltyAud: z.number().nullable(),
    wasteActivity: z.boolean().default(false),
  }),
]);
export type NewItem = z.infer<typeof NewItem>;

export type StoredItem = {
  id: string;
  sourceId: string;
  kind: NewItem['kind'];
  jurisdiction: Jurisdiction;
  title: string;
  url: string;
  publishedAt: string | null;
  body: string;
  detailUrl: string | null;
  detailFetchedAt: string | null;
  party: string | null;
  partyGroup: string | null;
  action: string | null;
  location: string | null;
  penaltyAud: number | null;
  penaltySourceAud: number | null;
  contentHash: string;
  wasteActivity: boolean;
  answers: unknown;
  summary: Summary | null;
  closesOn: string | null;
  startsOn: string | null;
};
