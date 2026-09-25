import { ResultAsync } from 'neverthrow';
import { z } from 'zod';
import type { Jurisdiction } from '../items';
import { readAtom, type AtomEntry } from './atom';
import { changed, parseError, uniqueBy } from './common';
import { between, htmlToText } from './html';
import { getJson, getText } from './http';
import type { FetchOutcome, Source, SourceError } from './types';

// Feeds keep ~1 week of items.

type FeedSpec = { id: string; label: string };

const itemsOf = ({ entries, feed, jurisdiction, textUrl }: { entries: AtomEntry[]; feed: FeedSpec; jurisdiction: Jurisdiction; textUrl: ((entry: AtomEntry) => string | null) | null }) =>
  entries.map((entry) => ({
    kind: 'regulatory',
    // Same law returns later as new version: date is in ID.
    externalId: `${feed.id}:${entry.id}:${entry.updated ?? ''}`,
    jurisdiction,
    title: entry.title,
    url: entry.link,
    publishedAt: entry.updated,
    body: `${feed.label}: ${entry.title}`,
    detailUrl: textUrl?.(entry) ?? null,
  }));

const firstOfEachId = <T extends { externalId: string }>(records: T[]) => uniqueBy(records, (r) => r.externalId);

// Sequential: NSW server rate-limits.
const readFeeds = ({ base, feeds }: { base: string; feeds: FeedSpec[] }) =>
  feeds.reduce<ResultAsync<{ feed: FeedSpec; entries: AtomEntry[] }[], SourceError>>(
    (done, feed) => done.andThen((acc) => getText({ url: `${base}/feed?id=${feed.id}` }).map(({ text }) => [...acc, { feed, entries: readAtom(text) }])),
    ResultAsync.fromSafePromise(Promise.resolve([])),
  );

// Backfill: undocumented query endpoint. Records map to feed entry shape, so IDs match.
type Backfill = {
  ds: string;
  printTypes: string[];
  toEntry: (record: DalRecord) => { feed: FeedSpec; entry: AtomEntry };
};

// TAS truncates responses at ~32 KB.
const DAL_PAGE_SIZE = 50;

const Value = z.object({ __value__: z.string() });
const DalRecord = z.object({ id: Value, title: Value, 'publication.date': z.string(), 'print.type': Value });
type DalRecord = z.infer<typeof DalRecord>;
const DalPage = z.object({
  data: z.union([z.array(DalRecord), DalRecord.transform((record) => [record])]).default([]),
  totalCount: z.object({ __value__: z.number() }),
});

const dalExpression = ({ printTypes, since }: { printTypes: string[]; since: string }) =>
  `PrintType=(${printTypes.map((t) => `"${t}"`).join(' OR ')}) AND PublicationDate>=${since.slice(0, 10).replace(/-/g, '')}000000`;

const dalEntries = ({ json, backfill }: { json: unknown; backfill: Backfill }) => {
  const parsed = DalPage.safeParse(json);
  if (!parsed.success) return null;
  return { total: parsed.data.totalCount.__value__, entries: parsed.data.data.map(backfill.toEntry) };
};

const backfillPage = ({
  base,
  backfill,
  since,
  start,
  jurisdiction,
  textUrl,
}: {
  base: string;
  backfill: Backfill;
  since: string;
  start: number;
  jurisdiction: Jurisdiction;
  textUrl: ((entry: AtomEntry) => string | null) | null;
}): ResultAsync<FetchOutcome, SourceError> => {
  const params = new URLSearchParams({
    ds: backfill.ds,
    subset: 'browse',
    start: String(start),
    count: String(DAL_PAGE_SIZE),
    expression: dalExpression({ printTypes: backfill.printTypes, since }),
    sortField: 'publication.date',
    sortDirection: 'asc',
  });
  const url = `${base}/projectdata?${params}`;
  return getJson({ url }).andThen(({ json }) => {
    const page = dalEntries({ json, backfill });
    if (page === null) return parseError(url, 'The query response is not in the expected form.');
    const next = start + DAL_PAGE_SIZE;
    return changed({
      records: firstOfEachId(page.entries.flatMap(({ feed, entry }) => itemsOf({ entries: [entry], feed, jurisdiction, textUrl }))),
      next: next > page.total ? null : next,
    });
  });
};

const dalEntry = ({ record, link }: { record: DalRecord; link: string }): AtomEntry => ({
  id: record.id.__value__,
  title: record.title.__value__,
  link,
  updated: record['publication.date'].slice(0, 10),
});

const pcoSource = ({
  id,
  name,
  jurisdiction,
  base,
  feeds,
  textUrl,
  backfill,
}: {
  id: string;
  name: string;
  jurisdiction: Jurisdiction;
  base: string;
  feeds: FeedSpec[];
  textUrl: ((entry: AtomEntry) => string | null) | null;
  backfill: Backfill | null;
}): Source => ({
  id,
  name,
  kind: 'regulatory',
  homepage: base,
  ...(textUrl === null ? {} : { extractDetail: extractPcoText, prose: true }),
  run: ({ page, since }) => {
    if (since !== null && backfill !== null) {
      return backfillPage({ base, backfill, since, start: z.number().catch(1).parse(page ?? 1), jurisdiction, textUrl });
    }
    return readFeeds({ base, feeds }).andThen((results) => changed({ records: firstOfEachId(results.flatMap(({ feed, entries }) => itemsOf({ entries, feed, jurisdiction, textUrl }))) }));
  },
});

const extractPcoText = (html: string) => htmlToText(between({ html, start: /<[^>]+id="fragview"/i, end: /<footer\b|id="footer"/i }));

// Only as-made laws: reprints can be many MB and do not show change.
const wholeView = (entry: AtomEntry) => (entry.link.includes('/view/html/asmade/') ? entry.link.replace('/view/html/', '/view/whole/html/') : null);

const QLD = 'https://www.legislation.qld.gov.au';
const QLD_NEW_LEGISLATION: FeedSpec = { id: 'newlegislation', label: 'New Act or subordinate legislation' };
const QLD_NEW_BILLS: FeedSpec = { id: 'newbills', label: 'New bill' };

export const qldLegislation = pcoSource({
  id: 'qld-legislation',
  name: 'QLD legislation (new Acts, subordinate legislation and bills)',
  jurisdiction: 'QLD',
  base: QLD,
  feeds: [QLD_NEW_LEGISLATION, QLD_NEW_BILLS],
  textUrl: wholeView,
  backfill: {
    ds: 'OQPC-BrowseDataSource',
    printTypes: ['act.new', 'published', 'bill.first', 'bill.firstnongovintro'],
    toEntry: (record) =>
      record['print.type'].__value__.startsWith('bill.')
        ? { feed: QLD_NEW_BILLS, entry: dalEntry({ record, link: `${QLD}/view/html/bill.first/${record.id.__value__}` }) }
        : { feed: QLD_NEW_LEGISLATION, entry: dalEntry({ record, link: `${QLD}/view/html/asmade/${record.id.__value__}` }) },
  },
});

const TAS = 'https://www.legislation.tas.gov.au';
const TAS_WHATS_NEW: FeedSpec = { id: 'whatsnew', label: 'New or changed legislation' };

export const tasLegislation = pcoSource({
  id: 'tas-legislation',
  name: 'TAS legislation (what is new)',
  jurisdiction: 'TAS',
  base: TAS,
  feeds: [TAS_WHATS_NEW],
  textUrl: wholeView,
  // Here "act.new"/"published" include changed versions.
  backfill: {
    ds: 'EnAct-BrowseDataSource',
    printTypes: ['act.new', 'published'],
    toEntry: (record) => ({ feed: TAS_WHATS_NEW, entry: dalEntry({ record, link: `${TAS}/view/html/inforce/current/${record.id.__value__}` }) }),
  },
});

// NSW blocks law-text fetch: Jev sees title only.
export const nswLegislation = pcoSource({
  id: 'nsw-legislation',
  name: 'NSW legislation (new in force versions and bills)',
  jurisdiction: 'NSW',
  base: 'https://legislation.nsw.gov.au',
  feeds: [
    { id: 'newinforce', label: 'New in force version' },
    { id: 'newbills', label: 'New bill' },
  ],
  textUrl: null,
  backfill: null,
});
