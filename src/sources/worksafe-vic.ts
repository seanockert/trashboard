import type { ResultAsync } from 'neverthrow';
import { z } from 'zod';
import { changed, newestFirstPage, paged, parseError, unchanged } from './common';
import { htmlToText } from './html';
import { getJson } from './http';
import type { FetchOutcome, Source, SourceError } from './types';

// Undocumented search API, newest first.
const API = 'https://content-v2.api.worksafe.vic.gov.au/api/v2/search-record';
const SITE = 'https://www.worksafe.vic.gov.au';
const REGISTER_PAGE = `${SITE}/prosecution-result-summaries-enforceable-undertakings`;
const PAGE_ROWS = 20;
const MAX_PAGES = 200;

const PrsRecord = z.object({
  record_id: z.number(),
  record_title: z.string(),
  record_outcome: z.string().nullish(),
  record_prs_dateoutcome: z.number().nullish(),
  data: z.object({ attributes: z.object({ field_prs_type: z.string().nullish() }) }).optional(),
});
type PrsRecord = z.infer<typeof PrsRecord>;
const SearchResponse = z.object({ numFound: z.number(), results: z.array(PrsRecord) });

const isoDay = (seconds: number | null | undefined) => (seconds === null || seconds === undefined ? null : new Date(seconds * 1000).toISOString().slice(0, 10));

export const toRecord = (r: PrsRecord) => {
  const undertaking = r.data?.attributes.field_prs_type === 'EU';
  const action = undertaking ? 'Enforceable undertaking' : 'WHS prosecution';
  return {
    kind: 'enforcement',
    externalId: String(r.record_id),
    jurisdiction: 'VIC',
    title: `${action}: ${r.record_title}`,
    url: `${SITE}/record/${r.record_id}`,
    publishedAt: isoDay(r.record_prs_dateoutcome),
    body: htmlToText(r.record_outcome ?? ''),
    // Suppressed name is a court number (e.g. "SC36 of 2026"); company filter drops it.
    party: r.record_title.trim(),
    action,
    location: null,
    penaltyAud: null,
  };
};

const REREAD_DAYS = 90;
const PageState = z.object({ page: z.number(), newest: z.string().nullable() });

const fetchPage = ({ page, cursor, newestSoFar }: { page: number; cursor: string | null; newestSoFar: string | null }): ResultAsync<FetchOutcome, SourceError> => {
  const params = new URLSearchParams({
    record_type: 'prs',
    rows: String(PAGE_ROWS),
    start: String(page * PAGE_ROWS),
    sort: 'record_prs_dateoutcome',
    order: 'desc',
    model: 'lite',
    _format: 'json',
  });
  const url = `${API}?${params}`;
  return getJson({ url }).andThen(({ json }) => {
    const parsed = SearchResponse.safeParse(json);
    if (!parsed.success) return parseError(url, parsed.error.message);
    const records = parsed.data.results.map(toRecord);
    const { fresh, newest, reachedKnown } = newestFirstPage({ rows: records, dateOf: (r) => r.publishedAt, cursor, newestSoFar, rereadDays: REREAD_DAYS });
    const reachedEnd = records.length < PAGE_ROWS || (page + 1) * PAGE_ROWS >= parsed.data.numFound || page + 1 >= MAX_PAGES;
    if (page === 0 && fresh.length === 0) return unchanged();
    return changed({ records: fresh, cursor: newest, next: reachedKnown || reachedEnd ? null : { page: page + 1, newest } });
  });
};

export const worksafeVic: Source = {
  id: 'worksafe-vic',
  name: 'WorkSafe Victoria prosecution result summaries',
  kind: 'enforcement',
  homepage: REGISTER_PAGE,
  prose: true,
  run: paged({
    url: API,
    state: PageState,
    first: ({ cursor }) => fetchPage({ page: 0, cursor, newestSoFar: null }),
    next: (state, { cursor }) => fetchPage({ page: state.page, cursor, newestSoFar: state.newest }),
  }),
};
