import { z } from 'zod';
import { changed, lines, paged, parseError, text, unchanged } from './common';
import { getJson } from './http';
import type { Source } from './types';

const API = 'https://www.data.qld.gov.au/api/3/action';
const PACKAGE = `${API}/package_show?id=enforcement-actions-register`;
const DATASET_PAGE = 'https://www.data.qld.gov.au/dataset/enforcement-actions-register';
const PAGE_ROWS = 400;

// ERA 53-62 = waste activities. ERA 63 = sewage, not waste.
const WASTE_ERA = /\bERA\s*(5[3-9]|6[0-2])\b/i;

const Package = z.object({
  result: z.object({
    resources: z.array(z.object({ id: z.string(), format: z.string(), last_modified: z.string().nullable(), datastore_active: z.boolean().optional() })),
  }),
});

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

const Page = z.object({ resourceId: z.string(), offset: z.number(), cursor: z.string().nullable() });
type Page = z.infer<typeof Page>;

const unique = (values: string[]) => [...new Set(values.filter((v) => v !== ''))];

// One reference can have many rows, one per event.
const groupByReference = (rows: Row[]) =>
  Object.entries(Object.groupBy(rows, (r) => r['Enforcement Reference'])).flatMap(([reference, group]): [string, Row[]][] =>
    group === undefined || reference === '' ? [] : [[reference, group]],
  );

const toRecord = ([reference, rows]: [string, Row[]]) => {
  const types = unique(rows.map((r) => r['Enforcement Type']));
  const dates = unique(rows.map((r) => r['Issued Date'].slice(0, 10))).sort();
  const party = unique(rows.map((r) => r['Issued To'])).join('; ');
  const activities = unique(rows.map((r) => r.Activities)).join('; ');
  return {
    kind: 'enforcement',
    externalId: reference,
    jurisdiction: 'QLD',
    title: `${types.join(', ') || 'Enforcement action'}: ${party}`,
    url: `${DATASET_PAGE}#${encodeURIComponent(reference)}`,
    publishedAt: dates[0] ?? null,
    body: lines([
      ['Enforcement type', types.join('; ')],
      ['Status', unique(rows.map((r) => r.Status)).join('; ')],
      ['Activities', activities],
      ['Related environmental authority', unique(rows.map((r) => r['Related Environmental Authority'])).join('; ')],
      ['Subsequent action', unique(rows.map((r) => r['Subsequent Action'])).join('; ')],
    ]),
    party,
    action: types.join('; ') || 'Enforcement action',
    location: unique(rows.map((r) => r.Locations)).join('; ') || null,
    penaltyAud: null,
    wasteActivity: WASTE_ERA.test(activities),
  };
};

// Full page can end mid-reference: that reference starts next page.
export const splitPage = ({ rows, offset, total }: { rows: Row[]; offset: number; total: number }) => {
  const isLast = offset + rows.length >= total || rows.length < PAGE_ROWS;
  if (isLast) return { rows, nextOffset: null };
  const lastRef = rows.at(-1)?.['Enforcement Reference'];
  const cut = rows.findIndex((r) => r['Enforcement Reference'] === lastRef);
  return cut <= 0 ? { rows, nextOffset: offset + rows.length } : { rows: rows.slice(0, cut), nextOffset: offset + cut };
};

export const recordsFromRows = (rows: Row[]) => groupByReference(rows).map(toRecord).filter((r) => r.party !== '');

const fetchPage = (page: Page) => {
  const params = new URLSearchParams({
    resource_id: page.resourceId,
    limit: String(PAGE_ROWS),
    offset: String(page.offset),
    sort: '"Enforcement Reference" asc, _id asc',
  });
  const url = `${API}/datastore_search?${params}`;
  return getJson({ url }).andThen(({ json }) => {
    const parsed = Search.safeParse(json);
    if (!parsed.success) return parseError(url, parsed.error.message);
    const { rows, nextOffset } = splitPage({ rows: parsed.data.result.records, offset: page.offset, total: parsed.data.result.total });
    return changed({ records: recordsFromRows(rows), cursor: page.cursor, next: nextOffset === null ? null : { ...page, offset: nextOffset } });
  });
};

const firstPage = (cursor: string | null) =>
  getJson({ url: PACKAGE }).andThen(({ json }) => {
    const parsed = Package.safeParse(json);
    if (!parsed.success) return parseError(PACKAGE, parsed.error.message);
    const resource = parsed.data.result.resources.find((r) => r.datastore_active === true);
    if (resource === undefined) return parseError(PACKAGE, 'No resource with an active datastore.');
    if (resource.last_modified !== null && resource.last_modified === cursor) return unchanged();
    return fetchPage({ resourceId: resource.id, offset: 0, cursor: resource.last_modified });
  });

export const qldEnforcement: Source = {
  id: 'qld-enforcement',
  name: 'QLD enforcement actions register (DETSI)',
  kind: 'enforcement',
  homepage: DATASET_PAGE,
  run: paged({ url: PACKAGE, state: Page, first: ({ cursor }) => firstPage(cursor), next: fetchPage }),
};
