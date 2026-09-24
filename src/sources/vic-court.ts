import type { ResultAsync } from 'neverthrow';
import { z } from 'zod';
import { badPageState, changed, newestFirstPage, parseError, unchanged } from './common';
import { mainText } from './html';
import { getJson } from './http';
import type { FetchOutcome, Source, SourceError } from './types';
import { sitePath } from './vic-search';

// The JSON API behind the EPA Victoria court proceedings register. It gives
// 10 records for each page, newest first.
const API = 'https://www.epa.vic.gov.au/api/public-register/court-proceedings';
const SITE = 'https://www.epa.vic.gov.au';
const REGISTER_PAGE = 'https://www.epa.vic.gov.au/public-registers';
const MAX_PAGES = 60;

const Page = z.object({
  total: z.coerce.number(),
  records: z.array(z.object({ nid: z.number(), title: z.string(), url: z.string(), location: z.string().nullable(), date: z.string() })),
});
type CourtRecord = z.infer<typeof Page>['records'][number];

const toItem = (record: CourtRecord) => {
  const url = `${SITE}${sitePath(record.url)}`;
  return {
    kind: 'enforcement',
    externalId: String(record.nid),
    jurisdiction: 'VIC',
    title: `Court proceeding: ${record.title}`,
    url,
    publishedAt: record.date.slice(0, 10),
    body: '',
    detailUrl: url,
    // The ACN stays. It shows that the party is a company.
    party: record.title,
    action: 'Court proceeding',
    location: record.location,
    penaltyAud: null,
  };
};

// One API page for each invocation.
const REREAD_DAYS = 90;
const PageState = z.object({ page: z.number(), newest: z.string().nullable() });

const fetchPage = ({ page, cursor, newestSoFar }: { page: number; cursor: string | null; newestSoFar: string | null }): ResultAsync<FetchOutcome, SourceError> => {
  const url = `${API}?page=${page}&pageSize=10`;
  return getJson({ url }).andThen(({ json }) => {
    const parsed = Page.safeParse(json);
    if (!parsed.success) return parseError(url, parsed.error.message);
    const records = parsed.data.records;
    const { fresh, newest, reachedKnown } = newestFirstPage({ rows: records, dateOf: (r) => r.date, cursor, newestSoFar, rereadDays: REREAD_DAYS });
    const reachedEnd = records.length === 0 || page * 10 >= parsed.data.total || page >= MAX_PAGES;
    if (page === 1 && fresh.length === 0) return unchanged();
    return changed({ records: fresh.map(toItem), cursor: newest, next: reachedKnown || reachedEnd ? null : { page: page + 1, newest } });
  });
};

export const extractVicDetail = (html: string) => {
  const text = mainText(html);
  const start = text.indexOf('Date of offence');
  const end = text.lastIndexOf('\nUpdated');
  return text.slice(start < 0 ? 0 : start, end < 0 ? undefined : end).trim();
};

export const vicCourt: Source = {
  id: 'vic-court',
  name: 'EPA Victoria court proceedings register',
  kind: 'enforcement',
  jurisdiction: 'VIC',
  homepage: REGISTER_PAGE,
  extractDetail: extractVicDetail,
  run: ({ cursor, page }) => {
    if (page === null) return fetchPage({ page: 1, cursor, newestSoFar: null });
    const state = PageState.safeParse(page);
    return state.success ? fetchPage({ page: state.data.page, cursor, newestSoFar: state.data.newest }) : badPageState(API);
  },
};
