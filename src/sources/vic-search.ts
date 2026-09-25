import type { ResultAsync } from 'neverthrow';
import { z } from 'zod';
import { changed, FIRST_RUN_DAYS, paged, parseError, unchanged } from './common';
import { daysAgo, newestOf } from './dates';
import { htmlToText } from './html';
import { postJson } from './http';
import type { FetchOutcome, Source, SourceError } from './types';

// Undocumented search proxy: schema check fails loudly on change.

const SIZE = 200;

// Paths can start with site ID, e.g. "/site-1523/news/...".
export const sitePath = (path: string) => path.replace(/^\/site-\d+/, '');

const first = z.array(z.string()).transform((list) => list[0] ?? '');
const firstOptional = z.array(z.string()).optional().transform((list) => list?.[0] ?? '');

// Article text often repeats the summary. Keep one copy.
export const newsBody = (summary: string, text: string) =>
  summary === '' || text.startsWith(summary) ? text : text === '' ? summary : `${summary}\n${text}`;

const Hits = z.object({ hits: z.object({ hits: z.array(z.object({ _source: z.unknown() })) }) });

const PageState = z.object({ since: z.string(), from: z.number(), newest: z.string().nullable() });

// Oldest first: new items during a run go to end, pages do not shift.
const run =
  <T extends z.ZodType, R>({
    url,
    dateField,
    dateOf,
    filters,
    schema,
    toItem,
  }: {
    url: string;
    dateField: string;
    dateOf: (hit: z.infer<T>) => string;
    filters: unknown[];
    schema: T;
    toItem: (hit: z.infer<T>) => R;
  }) => {
  const fetchPage = (state: z.infer<typeof PageState>): ResultAsync<FetchOutcome, SourceError> => {
    const body = {
      size: SIZE,
      from: state.from,
      _source: { excludes: ['es_attachment*', 'rendered_item*'] },
      query: { bool: { filter: [...filters, { range: { [dateField]: { gte: state.since } } }] } },
      sort: [{ [dateField]: 'asc' }],
    };
    return postJson({ url, body }).andThen(({ json }) => {
      const envelope = Hits.safeParse(json);
      if (!envelope.success) return parseError(url, envelope.error.message);
      const parsed = z.array(schema).safeParse(envelope.data.hits.hits.map((h) => h._source));
      if (!parsed.success) return parseError(url, parsed.error.message);
      const hits = parsed.data;
      if (state.from === 0 && hits.length === 0) return unchanged();
      const newest = newestOf([state.newest, ...hits.map(dateOf)]);
      const isLast = hits.length < SIZE;
      return changed({ records: hits.map(toItem), cursor: newest ?? state.since, next: isLast ? null : { since: state.since, from: state.from + SIZE, newest } });
    });
  };
  return paged({
    url,
    state: PageState,
    first: ({ cursor, now, since }) => fetchPage({ since: since ?? cursor ?? daysAgo(now, FIRST_RUN_DAYS), from: 0, newest: null }),
    next: fetchPage,
  });
};

const LEGISLATION_URL = 'https://www.legislation.vic.gov.au/api/tide/elasticsearch/content-legislation-vic-gov-au__production__sapi_node/_search';

const LegislationHit = z.object({
  nid: z.array(z.number()),
  title: first,
  type: first,
  url: first,
  changed: first,
  field_in_force_version_number: z.array(z.string()).optional(),
  field_in_force_effective_date: firstOptional,
});

const LEGISLATION_TYPES: Record<string, string> = {
  act_as_made: 'New Act as made',
  sr_as_made: 'New statutory rule as made',
  act_in_force: 'New in force version of an Act',
  sr_in_force: 'New in force version of a statutory rule',
};

export const vicLegislation: Source = {
  id: 'vic-legislation',
  name: 'VIC legislation (new and changed Acts and statutory rules)',
  kind: 'regulatory',
  homepage: 'https://www.legislation.vic.gov.au',
  run: run({
    url: LEGISLATION_URL,
    schema: LegislationHit,
    dateField: 'changed',
    dateOf: (hit) => hit.changed,
    filters: [{ terms: { type: Object.keys(LEGISLATION_TYPES) } }],
    toItem: (hit) => {
      const version = hit.field_in_force_version_number?.[0] ?? '';
      const label = LEGISLATION_TYPES[hit.type] ?? hit.type;
      return {
        kind: 'regulatory',
        externalId: `${hit.nid[0] ?? hit.url}:${version}`,
        jurisdiction: 'VIC',
        title: hit.title,
        url: `https://www.legislation.vic.gov.au${sitePath(hit.url)}`,
        publishedAt: (hit.field_in_force_effective_date || hit.changed).slice(0, 10),
        body: `${label}: ${hit.title}${version === '' ? '' : ` (version ${version})`}`,
      };
    },
  }),
};

const EPA_URL = 'https://www.epa.vic.gov.au/api/tide/elasticsearch/howqua__production__sapi_node/_search';
const EPA_SITE_ID = 1523;

const NewsHit = z.object({
  nid: z.array(z.number()),
  title: first,
  url: first,
  body: firstOptional,
  field_landing_page_summary: firstOptional,
  field_news_date: firstOptional,
  created: first,
});

export const epaVicNews: Source = {
  id: 'epa-vic-news',
  name: 'EPA Victoria news and media releases',
  kind: 'regulatory',
  homepage: 'https://www.epa.vic.gov.au/about-epa/news-and-updates',
  prose: true,
  run: run({
    url: EPA_URL,
    schema: NewsHit,
    dateField: 'created',
    dateOf: (hit) => hit.created,
    filters: [{ terms: { type: ['news', 'media_release'] } }, { terms: { field_node_site: [EPA_SITE_ID] } }],
    toItem: (hit) => ({
      kind: 'regulatory',
      externalId: String(hit.nid[0] ?? hit.url),
      jurisdiction: 'VIC',
      title: hit.title,
      url: `https://www.epa.vic.gov.au${sitePath(hit.url)}`,
      publishedAt: (hit.field_news_date || hit.created).slice(0, 10),
      body: newsBody(hit.field_landing_page_summary, htmlToText(hit.body)),
    }),
  }),
};
