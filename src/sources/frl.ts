import { errAsync, okAsync, type ResultAsync } from 'neverthrow';
import { z } from 'zod';
import { getJson } from './http';
import type { FetchOutcome, Source, SourceError } from './types';

// Federal Register of Legislation. New titles (Acts, legislative and
// notifiable instruments) with the department that administers each one.
const API = 'https://api.prod.legislation.gov.au/v1/Titles';
const SITE = 'https://www.legislation.gov.au';
const PAGE_SIZE = 200;
const MAX_PAGES = 10;
const FIRST_RUN_DAYS = 30;

const COLLECTION_LABELS: Record<string, string> = {
  Act: 'Act',
  LegislativeInstrument: 'Legislative instrument',
  NotifiableInstrument: 'Notifiable instrument',
  Gazette: 'Gazette notice',
};

const Title = z.object({
  id: z.string(),
  name: z.string(),
  collection: z.string(),
  asMadeRegisteredAt: z.string(),
  makingDate: z.string().nullable(),
  administeringDepartments: z.array(z.object({ name: z.string() })).default([]),
});
type Title = z.infer<typeof Title>;

const Page = z.object({ value: z.array(Title) });

// The API refuses a date with a "Z" suffix.
const odataDate = (iso: string) => iso.slice(0, 19);

const pageUrl = ({ since, skip }: { since: string; skip: number }) => {
  const params = new URLSearchParams({
    $filter: `asMadeRegisteredAt ge ${odataDate(since)}`,
    $select: 'id,name,collection,asMadeRegisteredAt,makingDate',
    $expand: 'administeringDepartments',
    $orderby: 'asMadeRegisteredAt asc',
    $top: String(PAGE_SIZE),
    $skip: String(skip),
  });
  return `${API}?${params}`;
};

const PageState = z.object({ since: z.string(), page: z.number(), newest: z.string().nullable() });

const fetchPage = ({ since, page, newestSoFar }: { since: string; page: number; newestSoFar: string | null }): ResultAsync<FetchOutcome, SourceError> => {
  const url = pageUrl({ since, skip: page * PAGE_SIZE });
  return getJson({ url }).andThen(({ json, text }) => {
    const parsed = Page.safeParse(json);
    if (!parsed.success) return errAsync<FetchOutcome, SourceError>({ type: 'parse', url, message: parsed.error.message });
    const titles = parsed.data.value;
    if (page === 0 && titles.length === 0) return okAsync<FetchOutcome, SourceError>({ type: 'unchanged' });
    const newest = [newestSoFar, ...titles.map((t) => t.asMadeRegisteredAt)].filter((d): d is string => d !== null).sort().at(-1) ?? null;
    const isLast = titles.length < PAGE_SIZE || page + 1 >= MAX_PAGES;
    return okAsync<FetchOutcome, SourceError>({
      type: 'changed',
      records: titles.map(toItem),
      cursor: newest ?? since,
      raw: [{ name: `titles-${page}.json`, body: text }],
      next: isLast ? null : { since, page: page + 1, newest },
    });
  });
};

const toItem = (title: Title) => {
  const collection = COLLECTION_LABELS[title.collection] ?? title.collection;
  const departments = title.administeringDepartments.map((d) => d.name).join('; ');
  return {
    kind: 'regulatory',
    externalId: title.id,
    jurisdiction: 'CTH',
    title: title.name,
    url: `${SITE}/${title.id}/asmade/text`,
    publishedAt: title.asMadeRegisteredAt.slice(0, 10),
    body: [`Type: ${collection}`, departments === '' ? null : `Administered by: ${departments}`, title.makingDate === null ? null : `Made: ${title.makingDate.slice(0, 10)}`]
      .filter((line) => line !== null)
      .join('\n'),
  };
};

export const federalRegister: Source = {
  id: 'frl',
  name: 'Federal Register of Legislation (new titles)',
  kind: 'regulatory',
  jurisdiction: 'CTH',
  homepage: SITE,
  run: ({ cursor, now, page }) => {
    if (page === null) {
      return fetchPage({ since: cursor ?? new Date(now.getTime() - FIRST_RUN_DAYS * 86_400_000).toISOString(), page: 0, newestSoFar: null });
    }
    const state = PageState.safeParse(page);
    return state.success ? fetchPage({ since: state.data.since, page: state.data.page, newestSoFar: state.data.newest }) : errAsync({ type: 'parse', url: API, message: 'The page state is not valid.' });
  },
};
