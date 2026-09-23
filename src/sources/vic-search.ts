import { errAsync, okAsync, ResultAsync } from 'neverthrow';
import { z } from 'zod';
import { htmlToText } from './html';
import type { FetchOutcome, Source, SourceError } from './types';

// Victorian government sites run on one platform with an open search proxy.
// It is not a documented API, thus the schema check here fails loudly if it changes.

const USER_AGENT = 'Trashboard/0.1 (private research tool; one request per source per day)';
const FIRST_RUN_DAYS = 30;
const SIZE = 200;

const searchPost = ({ url, body }: { url: string; body: unknown }) =>
  ResultAsync.fromPromise(
    fetch(url, { method: 'POST', headers: { 'user-agent': USER_AGENT, 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (res) => ({
      status: res.status,
      text: await res.text(),
    })),
    (cause): SourceError => ({ type: 'network', url, cause }),
  ).andThen(({ status, text }) => {
    if (status < 200 || status >= 300) return errAsync<unknown, SourceError>({ type: 'http', url, status });
    return ResultAsync.fromPromise(
      Promise.resolve().then((): unknown => JSON.parse(text)),
      (): SourceError => ({ type: 'parse', url, message: 'The response is not valid JSON.' }),
    );
  });

// Each field comes as a list with one value.
const first = z.array(z.string()).transform((list) => list[0] ?? '');
const firstOptional = z.array(z.string()).optional().transform((list) => list?.[0] ?? '');

const Hits = z.object({ hits: z.object({ hits: z.array(z.object({ _source: z.unknown() })) }) });

const sinceOf = ({ cursor, now }: { cursor: string | null; now: Date }) => cursor ?? new Date(now.getTime() - FIRST_RUN_DAYS * 86_400_000).toISOString();

const run =
  <T extends z.ZodType, R>({ url, query, schema, toItem, dateOf }: { url: string; query: (since: string) => unknown; schema: T; toItem: (hit: z.infer<T>) => R; dateOf: (hit: z.infer<T>) => string }) =>
  ({ cursor, now }: { cursor: string | null; now: Date }) =>
    searchPost({ url, body: query(sinceOf({ cursor, now })) }).andThen((json) => {
      const envelope = Hits.safeParse(json);
      const parsed = z.array(schema).safeParse(envelope.success ? envelope.data.hits.hits.map((h) => h._source) : null);
      if (!parsed.success) return errAsync<FetchOutcome, SourceError>({ type: 'parse', url, message: parsed.error.message });
      const hits = parsed.data;
      if (hits.length === 0) return okAsync<FetchOutcome, SourceError>({ type: 'unchanged' });
      const newest = hits.map(dateOf).sort().at(-1) ?? null;
      return okAsync<FetchOutcome, SourceError>({ type: 'changed', records: hits.map(toItem), cursor: newest, next: null, raw: [{ name: 'search.json', body: JSON.stringify(json) }] });
    });

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
  jurisdiction: 'VIC',
  homepage: 'https://www.legislation.vic.gov.au',
  run: run({
    url: LEGISLATION_URL,
    schema: LegislationHit,
    dateOf: (hit) => hit.changed,
    query: (since) => ({
      size: SIZE,
      _source: { excludes: ['es_attachment*', 'rendered_item*'] },
      query: { bool: { filter: [{ terms: { type: Object.keys(LEGISLATION_TYPES) } }, { range: { changed: { gte: since } } }] } },
      sort: [{ changed: 'desc' }],
    }),
    toItem: (hit) => {
      const version = hit.field_in_force_version_number?.[0] ?? '';
      const label = LEGISLATION_TYPES[hit.type] ?? hit.type;
      return {
        kind: 'regulatory',
        externalId: `${hit.nid[0] ?? hit.url}:${version}`,
        jurisdiction: 'VIC',
        title: hit.title,
        url: `https://www.legislation.vic.gov.au${hit.url.replace(/^\/site-\d+/, '')}`,
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
  jurisdiction: 'VIC',
  homepage: 'https://www.epa.vic.gov.au/about-epa/news-and-updates',
  run: run({
    url: EPA_URL,
    schema: NewsHit,
    dateOf: (hit) => hit.created,
    query: (since) => ({
      size: SIZE,
      _source: { excludes: ['es_attachment*', 'rendered_item*'] },
      query: { bool: { filter: [{ terms: { type: ['news', 'media_release'] } }, { terms: { field_node_site: [EPA_SITE_ID] } }, { range: { created: { gte: since } } }] } },
      sort: [{ created: 'desc' }],
    }),
    toItem: (hit) => ({
      kind: 'regulatory',
      externalId: String(hit.nid[0] ?? hit.url),
      jurisdiction: 'VIC',
      title: hit.title,
      url: `https://www.epa.vic.gov.au${hit.url.replace(/^\/site-\d+/, '')}`,
      publishedAt: (hit.field_news_date || hit.created).slice(0, 10),
      body: [hit.field_landing_page_summary, htmlToText(hit.body)].filter((text) => text !== '').join('\n'),
    }),
  }),
};
