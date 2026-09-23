import { ResultAsync } from 'neverthrow';
import type { Jurisdiction } from '../items';
import { readAtom, type AtomEntry } from './atom';
import { between, htmlToText } from './html';
import { getText } from './http';
import type { Source, SourceError } from './types';

// QLD, NSW and TAS use the same legislation platform, with Atom feeds for
// each kind of change. The feeds keep about one week of items.

type FeedSpec = { id: string; label: string };

const itemsOf = ({ entries, feed, jurisdiction, textUrl }: { entries: AtomEntry[]; feed: FeedSpec; jurisdiction: Jurisdiction; textUrl: ((entry: AtomEntry) => string | null) | null }) =>
  entries.map((entry) => ({
    kind: 'regulatory',
    // The same law comes again in a later week as a new version, thus the date is part of the ID.
    externalId: `${feed.id}:${entry.id}:${entry.updated ?? ''}`,
    jurisdiction,
    title: entry.title,
    url: entry.link,
    publishedAt: entry.updated,
    body: `${feed.label}: ${entry.title}`,
    detailUrl: textUrl?.(entry) ?? null,
  }));

// A feed can list one law more than one time in a week.
const firstOfEachId = <T extends { externalId: string }>(records: T[]) => records.filter((r, i) => records.findIndex((o) => o.externalId === r.externalId) === i);

// Feeds are read one after another. The NSW server limits fast requests.
const readFeeds = ({ base, feeds }: { base: string; feeds: FeedSpec[] }) =>
  feeds.reduce<ResultAsync<{ feed: FeedSpec; entries: AtomEntry[]; xml: string }[], SourceError>>(
    (done, feed) => done.andThen((acc) => getText({ url: `${base}/feed?id=${feed.id}` }).map(({ text }) => [...acc, { feed, entries: readAtom(text), xml: text }])),
    ResultAsync.fromSafePromise(Promise.resolve([])),
  );

export const pcoSource = ({
  id,
  name,
  jurisdiction,
  base,
  feeds,
  textUrl,
}: {
  id: string;
  name: string;
  jurisdiction: Jurisdiction;
  base: string;
  feeds: FeedSpec[];
  textUrl: ((entry: AtomEntry) => string | null) | null;
}): Source => ({
  id,
  name,
  kind: 'regulatory',
  jurisdiction,
  homepage: base,
  ...(textUrl === null ? {} : { extractDetail: extractPcoText }),
  run: () =>
    readFeeds({ base, feeds }).map((results) => ({
      type: 'changed' as const,
      records: firstOfEachId(results.flatMap(({ feed, entries }) => itemsOf({ entries, feed, jurisdiction, textUrl }))),
      cursor: null,
      next: null,
      raw: results.map(({ feed, xml }) => ({ name: `${feed.id}.xml`, body: xml })),
    })),
});

// The law text starts at the fragment view. The table of contents comes before it.
export const extractPcoText = (html: string) => htmlToText(between({ html, start: /<[^>]+id="fragview"/i, end: /<footer\b|id="footer"/i }));

// "/view/html/asmade/act-2026-021" -> "/view/whole/html/asmade/act-2026-021".
// Only a new law, as made, has useful text. A reprint of an old Act can be
// many megabytes, and its text does not show what changed.
const wholeView = (entry: AtomEntry) => (entry.link.includes('/view/html/asmade/') ? entry.link.replace('/view/html/', '/view/whole/html/') : null);

export const qldLegislation = pcoSource({
  id: 'qld-legislation',
  name: 'QLD legislation (new Acts, subordinate legislation and bills)',
  jurisdiction: 'QLD',
  base: 'https://www.legislation.qld.gov.au',
  feeds: [
    { id: 'newlegislation', label: 'New Act or subordinate legislation' },
    { id: 'newbills', label: 'New bill' },
  ],
  textUrl: wholeView,
});

export const tasLegislation = pcoSource({
  id: 'tas-legislation',
  name: 'TAS legislation (what is new)',
  jurisdiction: 'TAS',
  base: 'https://www.legislation.tas.gov.au',
  feeds: [{ id: 'whatsnew', label: 'New or changed legislation' }],
  textUrl: wholeView,
});

// The NSW site blocks automated requests for the law text, thus Jev sees the title only.
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
});
