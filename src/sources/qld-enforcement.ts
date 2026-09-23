import { errAsync, okAsync } from 'neverthrow';
import { z } from 'zod';
import { getJson } from './http';
import type { FetchOutcome, Source, SourceError } from './types';

const API = 'https://www.data.qld.gov.au/api/3/action';
const PACKAGE = `${API}/package_show?id=enforcement-actions-register`;
const DATASET_PAGE = 'https://www.data.qld.gov.au/dataset/enforcement-actions-register';
const PAGE_ROWS = 400;

// QLD environmentally relevant activities 53 to 63 are waste and resource recovery activities.
const WASTE_ERA = /\bERA\s*(5[3-9]|6[0-3])\b/i;

const Package = z.object({
  result: z.object({
    resources: z.array(z.object({ id: z.string(), format: z.string(), last_modified: z.string().nullable(), datastore_active: z.boolean().optional() })),
  }),
});

const text = z.string().nullable().transform((value) => (value ?? '').trim());
const Row = z.object({
  'Enforcement Reference': text,
  'Enforcement Type': text,
  'Issued To': text,
  'Issued Date': text,
  Status: text,
  Activities: text,
  Locations: text,
  'Related Environmental Authority': text,
  'Subsequent Action': text,
});
type Row = z.infer<typeof Row>;

const Search = z.object({ result: z.object({ total: z.number(), records: z.array(Row) }) });

// Pages continue with the same resource and the cursor of the first page.
const Page = z.object({ resourceId: z.string(), offset: z.number(), cursor: z.string().nullable() });
type Page = z.infer<typeof Page>;

const unique = (values: string[]) => [...new Set(values.filter((v) => v !== ''))];

// One enforcement reference can have several rows, one for each event.
const groupByReference = (rows: Row[]) =>
  Object.entries(Object.groupBy(rows, (r) => r['Enforcement Reference'])).flatMap(([reference, group]): [string, Row[]][] =>
    group === undefined || reference === '' ? [] : [[reference, group]],
  );

const toRecord = ([reference, rows]: [string, Row[]]) => {
  const types = unique(rows.map((r) => r['Enforcement Type']));
  const dates = unique(rows.map((r) => r['Issued Date'].slice(0, 10))).sort();
  const party = unique(rows.map((r) => r['Issued To'])).join('; ');
  const activities = unique(rows.map((r) => r.Activities)).join('; ');
  const lines = [
    ['Enforcement type', types.join('; ')],
    ['Status', unique(rows.map((r) => r.Status)).join('; ')],
    ['Activities', activities],
    ['Related environmental authority', unique(rows.map((r) => r['Related Environmental Authority'])).join('; ')],
    ['Subsequent action', unique(rows.map((r) => r['Subsequent Action'])).join('; ')],
  ].filter(([, value]) => value !== '');
  return {
    kind: 'enforcement',
    externalId: reference,
    jurisdiction: 'QLD',
    title: `${types.join(', ') || 'Enforcement action'}: ${party}`,
    url: `${DATASET_PAGE}#${encodeURIComponent(reference)}`,
    publishedAt: dates[0] ?? null,
    body: lines.map(([name, value]) => `${name}: ${value}`).join('\n'),
    party,
    action: types.join('; ') || 'Enforcement action',
    location: unique(rows.map((r) => r.Locations)).join('; ') || null,
    penaltyAud: null,
    wasteActivity: WASTE_ERA.test(activities),
  };
};

// A full page can end in the middle of a reference. That reference then
// starts the next page, so that no stored record holds only some of its rows.
export const splitPage = ({ rows, offset, total }: { rows: Row[]; offset: number; total: number }) => {
  const isLast = offset + rows.length >= total || rows.length < PAGE_ROWS;
  if (isLast) return { rows, nextOffset: null };
  const lastRef = rows.at(-1)?.['Enforcement Reference'];
  const cut = rows.findIndex((r) => r['Enforcement Reference'] === lastRef);
  // A page with one reference only cannot be cut.
  return cut <= 0 ? { rows, nextOffset: offset + rows.length } : { rows: rows.slice(0, cut), nextOffset: offset + cut };
};

export const recordsFromRows = (rows: Row[]) => groupByReference(rows).map(toRecord);

const fetchPage = (page: Page) => {
  const params = new URLSearchParams({
    resource_id: page.resourceId,
    limit: String(PAGE_ROWS),
    offset: String(page.offset),
    sort: '"Enforcement Reference" asc, _id asc',
  });
  const url = `${API}/datastore_search?${params}`;
  return getJson({ url }).andThen(({ json, text: body }) => {
    const parsed = Search.safeParse(json);
    if (!parsed.success) return errAsync<FetchOutcome, SourceError>({ type: 'parse', url, message: parsed.error.message });
    const { rows, nextOffset } = splitPage({ rows: parsed.data.result.records, offset: page.offset, total: parsed.data.result.total });
    return okAsync<FetchOutcome, SourceError>({
      type: 'changed',
      records: recordsFromRows(rows),
      cursor: page.cursor,
      raw: [{ name: `page-${page.offset}.json`, body }],
      next: nextOffset === null ? null : { ...page, offset: nextOffset },
    });
  });
};

// The first page checks the dataset. The resource `last_modified` changes each time QLD updates the register.
const firstPage = (cursor: string | null) =>
  getJson({ url: PACKAGE }).andThen(({ json }) => {
    const parsed = Package.safeParse(json);
    const resource = parsed.success ? parsed.data.result.resources.find((r) => r.datastore_active === true) : undefined;
    if (resource === undefined) return errAsync<FetchOutcome, SourceError>({ type: 'parse', url: PACKAGE, message: 'No resource with an active datastore.' });
    if (resource.last_modified !== null && resource.last_modified === cursor) return okAsync<FetchOutcome, SourceError>({ type: 'unchanged' });
    return fetchPage({ resourceId: resource.id, offset: 0, cursor: resource.last_modified });
  });

export const qldEnforcement: Source = {
  id: 'qld-enforcement',
  name: 'QLD enforcement actions register (DETSI)',
  kind: 'enforcement',
  jurisdiction: 'QLD',
  homepage: DATASET_PAGE,
  run: ({ cursor, page }) => {
    if (page === null) return firstPage(cursor);
    const parsed = Page.safeParse(page);
    return parsed.success ? fetchPage(parsed.data) : errAsync({ type: 'parse', url: PACKAGE, message: 'The page state is not valid.' });
  },
};
