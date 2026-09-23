import { z } from 'zod';

export const Jurisdiction = z.enum(['CTH', 'QLD', 'NSW', 'VIC', 'SA', 'WA', 'TAS', 'NT', 'ACT']);
export type Jurisdiction = z.infer<typeof Jurisdiction>;

// The longest source text that goes to Jev and into search. Jev accuracy
// drops when the state holds much text that does not help the judgment.
export const BODY_MAX = 4000;

const common = {
  externalId: z.string().min(1),
  jurisdiction: Jurisdiction,
  title: z.string().min(1),
  url: z.url(),
  publishedAt: z.iso.date().nullable(),
  body: z.string().transform((text) => text.slice(0, BODY_MAX)),
  // A page with the full text. The pipeline fetches it before Jev tags the item.
  detailUrl: z.url().nullable().default(null),
};

// What a source adapter gives back for each record.
export const NewItem = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('regulatory'), ...common }),
  z.object({
    kind: z.literal('enforcement'),
    ...common,
    party: z.string().min(1),
    action: z.string().min(1),
    location: z.string().nullable(),
    penaltyAud: z.number().nullable(),
    // The source states a waste activity, for example a QLD ERA code for waste disposal.
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
  wasteActivity: boolean;
  answers: unknown;
};
