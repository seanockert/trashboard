import { errAsync, okAsync, type ResultAsync } from 'neverthrow';
import { z } from 'zod';
import { htmlToText } from './html';
import { getJson } from './http';
import type { FetchOutcome, Source, SourceError } from './types';

// The search API behind the WorkSafe Victoria prosecution result summaries.
// It is not a documented API. It gives the newest outcomes first.
const API = 'https://content-v2.api.worksafe.vic.gov.au/api/v2/search-record';
const SITE = 'https://www.worksafe.vic.gov.au';
const REGISTER_PAGE = `${SITE}/prosecution-result-summaries-enforceable-undertakings`;
// A record is about 16 KB of JSON, thus a page of 20 is about 320 KB.
const PAGE_ROWS = 20;
const MAX_PAGES = 100;

const Record = z.object({
  record_id: z.number(),
  record_title: z.string(),
  record_outcome: z.string().nullish(),
  record_prs_dateoutcome: z.number().nullish(),
  data: z.object({ attributes: z.object({ field_prs_type: z.string().nullish() }) }).optional(),
});
type Record = z.infer<typeof Record>;
const Response = z.object({ numFound: z.number(), results: z.array(Record) });

const isoDay = (seconds: number | null | undefined) => (seconds === null || seconds === undefined ? null : new Date(seconds * 1000).toISOString().slice(0, 10));

export const toRecord = (r: Record) => {
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
    // A suppressed name is a court number, for example "SC36 of 2026". The company filter drops it.
    party: r.record_title.trim(),
    action,
    location: null,
    penaltyAud: null,
  };
};

// One API page for each invocation. Paging stops at a page that holds an
// outcome older than the last date seen, as in `vic-court.ts`.
const PageState = z.object({ page: z.number(), newest: z.string().nullable() });

const fetchPage = ({ page, since, newestSoFar }: { page: number; since: string | null; newestSoFar: string | null }): ResultAsync<FetchOutcome, SourceError> => {
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
  return getJson({ url }).andThen(({ json, text }) => {
    const parsed = Response.safeParse(json);
    if (!parsed.success) return errAsync<FetchOutcome, SourceError>({ type: 'parse', url, message: parsed.error.message.slice(0, 500) });
    const records = parsed.data.results.map(toRecord);
    const fresh = since === null ? records : records.filter((r) => r.publishedAt !== null && r.publishedAt >= since);
    const newest = [newestSoFar, ...fresh.map((r) => r.publishedAt)].filter((d): d is string => d !== null).sort().at(-1) ?? null;
    const reachedKnown = since !== null && records.some((r) => r.publishedAt !== null && r.publishedAt < since);
    const reachedEnd = records.length < PAGE_ROWS || (page + 1) * PAGE_ROWS >= parsed.data.numFound || page + 1 >= MAX_PAGES;
    if (page === 0 && fresh.length === 0) return okAsync<FetchOutcome, SourceError>({ type: 'unchanged' });
    return okAsync<FetchOutcome, SourceError>({
      type: 'changed',
      records: fresh,
      cursor: newest ?? since,
      raw: [{ name: `prs-${page}.json`, body: text }],
      next: reachedKnown || reachedEnd ? null : { page: page + 1, newest },
    });
  });
};

export const worksafeVic: Source = {
  id: 'worksafe-vic',
  name: 'WorkSafe Victoria prosecution result summaries',
  kind: 'enforcement',
  jurisdiction: 'VIC',
  homepage: REGISTER_PAGE,
  run: ({ cursor, page }) => {
    if (page === null) return fetchPage({ page: 0, since: cursor, newestSoFar: null });
    const state = PageState.safeParse(page);
    return state.success
      ? fetchPage({ page: state.data.page, since: cursor, newestSoFar: state.data.newest })
      : errAsync({ type: 'parse', url: API, message: 'The page state is not valid.' });
  },
};
