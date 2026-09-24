import { errAsync, okAsync, type ResultAsync } from 'neverthrow';
import { z } from 'zod';
import { PARTY_GROUPS } from '../parties';
import { datesIn } from './dates';
import { getJson, getText } from './http';
import type { FetchOutcome, Source, SourceError } from './types';

// Changes to the licences and environmental authorities that JJ Richards
// holds. Each change is a regulatory item. The views show every item that
// names JJ Richards, thus the user sees each change.
// A query to the source finds candidates by a broad name match. Code then
// keeps only the names that the JJ Richards pattern matches.
const JJR = PARTY_GROUPS[0];
const isJjr = (name: string) => JJR.pattern.test(name);

const parseError = (url: string, message: string) => errAsync<FetchOutcome, SourceError>({ type: 'parse', url, message: message.slice(0, 500) });

const changed = ({ records, name, body }: { records: unknown[]; name: string; body: string }) =>
  okAsync<FetchOutcome, SourceError>({ type: 'changed', records, cursor: null, raw: [{ name, body }], next: null });

// QLD: the register of applications for environmental authorities. A new
// status of an application changes its item, and the item then gets new tags.
const QLD_API = 'https://www.data.qld.gov.au/api/3/action';
const QLD_PACKAGE = `${QLD_API}/package_show?id=environmental-authority-applications`;
const QLD_DATASET = 'https://www.data.qld.gov.au/dataset/environmental-authority-applications';
// PostgreSQL regular expression. The JavaScript pattern of the group cannot go in the SQL as it is.
const QLD_NAMES = "(j\\.? ?j\\.?''?s? ?richards|jj''s waste|southern oil|createnergy|handybin)";

const text = z.string().nullish().transform((value) => (value ?? '').trim());
const QldApplication = z.object({
  'Application Number': z.string().min(1),
  'Application Action': text,
  'Principal Applicant': text,
  'Application Date': text,
  'Application Status': text,
  Activities: text,
  Locations: text,
  'Related Permit': text,
  'Permit Version': z.union([z.number(), z.string()]).nullish(),
  'Permit Status': text,
  'Permit Effective Date': text,
});
type QldApplication = z.infer<typeof QldApplication>;

const lines = (pairs: [string, string][]) =>
  pairs
    .filter(([, value]) => value !== '')
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n');

export const qldApplicationRecord = (a: QldApplication) => {
  const action = a['Application Action'] === 'Amend' ? 'Amendment application' : 'Application';
  return {
    kind: 'regulatory',
    externalId: a['Application Number'],
    jurisdiction: 'QLD',
    title: `QLD environmental authority ${action.toLowerCase()} ${a['Application Number']}: ${a['Principal Applicant']} (${a['Application Status'] || 'status not stated'})`,
    url: `${QLD_DATASET}#${encodeURIComponent(a['Application Number'])}`,
    publishedAt: a['Application Date'].slice(0, 10) || null,
    body: lines([
      ['Action', action],
      ['Applicant', a['Principal Applicant']],
      ['Application status', a['Application Status']],
      ['Environmental authority', a['Related Permit']],
      ['Permit version', a['Permit Version'] === null || a['Permit Version'] === undefined ? '' : String(a['Permit Version'])],
      ['Permit status', a['Permit Status']],
      ['Permit effective date', a['Permit Effective Date'].slice(0, 10)],
      ['Activities', a.Activities],
      ['Locations', a.Locations],
    ]),
  };
};

const QldPackage = z.object({ result: z.object({ resources: z.array(z.object({ id: z.string(), datastore_active: z.boolean().optional() })) }) });
const QldSql = z.object({ result: z.object({ records: z.array(QldApplication) }) });

const runQld = (): ResultAsync<FetchOutcome, SourceError> =>
  getJson({ url: QLD_PACKAGE }).andThen(({ json }) => {
    const resource = QldPackage.safeParse(json).data?.result.resources.find((r) => r.datastore_active === true);
    if (resource === undefined) return parseError(QLD_PACKAGE, 'No resource with an active datastore.');
    const sql = `SELECT * FROM "${resource.id}" WHERE "Principal Applicant" ~* '${QLD_NAMES}'`;
    const url = `${QLD_API}/datastore_search_sql?${new URLSearchParams({ sql })}`;
    return getJson({ url }).andThen(({ json: rows, text: body }) => {
      const parsed = QldSql.safeParse(rows);
      if (!parsed.success) return parseError(url, parsed.error.message);
      const records = parsed.data.result.records.filter((a) => isJjr(a['Principal Applicant'])).map(qldApplicationRecord);
      return changed({ records, name: 'applications.json', body });
    });
  });

export const qldLicences: Source = {
  id: 'qld-jjr-authorities',
  name: 'QLD environmental authority applications (JJ Richards)',
  kind: 'regulatory',
  jurisdiction: 'QLD',
  homepage: QLD_DATASET,
  run: runQld,
};

// VIC: EPA Victoria operating licences, from the Vicmap open data service.
// Each amendment date gives a new item, thus the old items keep the history.
const VIC_WFS = 'https://opendata.maps.vic.gov.au/geoserver/wfs';
const VIC_REGISTER = 'https://www.epa.vic.gov.au/public-registers';
const JJR_ACN = '000805425';

const VicFeature = z.object({
  properties: z.object({
    licence_number: z.string().min(1),
    status: text,
    date_issued: text,
    last_amended: text,
    permission_activity: text,
    place_or_premises: text,
    premises_address: text,
    acn: text,
  }),
});
type VicLicence = z.infer<typeof VicFeature>['properties'];
const VicCollection = z.object({ features: z.array(VicFeature) });

export const vicLicenceRecord = (l: VicLicence) => {
  const changedOn = (l.last_amended || l.date_issued).slice(0, 10);
  return {
    kind: 'regulatory',
    externalId: `${l.licence_number}:${changedOn}`,
    jurisdiction: 'VIC',
    title: `EPA Victoria licence ${l.licence_number} ${l.last_amended === '' ? 'issued' : 'amended'}: ${l.place_or_premises}`,
    url: VIC_REGISTER,
    publishedAt: changedOn || null,
    body: lines([
      ['Licence', l.licence_number],
      ['Holder and premises', l.place_or_premises],
      ['Address', l.premises_address],
      ['Status', l.status],
      ['Activities', l.permission_activity],
      ['Date issued', l.date_issued.slice(0, 10)],
      ['Last amended', l.last_amended.slice(0, 10)],
    ]),
  };
};

const runVic = (): ResultAsync<FetchOutcome, SourceError> => {
  const params = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: 'open-data-platform:epa_licence_point',
    outputFormat: 'application/json',
    propertyName: 'licence_number,status,date_issued,last_amended,permission_activity,place_or_premises,premises_address,acn',
    CQL_FILTER: `strToLowerCase(place_or_premises) LIKE '%richards%' OR acn = '${JJR_ACN}'`,
  });
  const url = `${VIC_WFS}?${params}`;
  return getJson({ url }).andThen(({ json, text: body }) => {
    const parsed = VicCollection.safeParse(json);
    if (!parsed.success) return parseError(url, parsed.error.message);
    const records = parsed.data.features
      .map((f) => f.properties)
      .filter((l) => l.acn === JJR_ACN || isJjr(l.place_or_premises))
      .map(vicLicenceRecord);
    return changed({ records, name: 'licences.json', body });
  });
};

export const vicLicences: Source = {
  id: 'vic-jjr-licences',
  name: 'EPA Victoria operating licences (JJ Richards)',
  kind: 'regulatory',
  jurisdiction: 'VIC',
  homepage: VIC_REGISTER,
  run: runVic,
};

// SA: the EPA public register gives each change to an authorisation, newest
// first. It has no name filter, thus code reads the recent changes of all
// holders and keeps JJ Richards. The response is JSONP, not JSON.
const SA_API = 'https://www.publicregister.epa.sa.gov.au/ajax/records/search';
const SA_REGISTER = 'https://www.publicregister.epa.sa.gov.au/';
const SA_PAGE_ROWS = 100;
// About three weeks of changes are on one page. A run with no cursor reads back about 12 months.
const SA_FIRST_RUN_PAGES = 17;
// CloudFront refuses requests without a browser user agent and an Accept header that includes JavaScript.
const SA_HEADERS = { 'user-agent': 'Mozilla/5.0 (compatible; Trashboard/0.1)', accept: 'application/json, text/javascript, */*' };

const SaChange = z.object({ id: z.number(), recordNumber: z.string(), version: z.number(), status: text, type: text, mainName: text, updateReason: text, dateImported: text });
type SaChange = z.infer<typeof SaChange>;
const SaPage = z.object({ total: z.number(), results: z.array(SaChange) });

// The JSON inside `callback(...)`. Null when the body is not JSONP.
export const readJsonp = (body: string): unknown => {
  try {
    return JSON.parse(body.slice(body.indexOf('(') + 1, body.lastIndexOf(')')));
  } catch {
    return null;
  }
};

export const saChangeRecord = (c: SaChange) => ({
  kind: 'regulatory',
  externalId: `${c.recordNumber}:${c.version}`,
  jurisdiction: 'SA',
  title: `SA EPA ${c.type.toLowerCase() || 'authorisation'} ${c.recordNumber}: ${c.updateReason || 'change'} (${c.mainName})`,
  url: SA_REGISTER,
  publishedAt: datesIn(c.dateImported)[0] ?? null,
  body: lines([
    ['Authorisation', `${c.type} ${c.recordNumber}`],
    ['Holder', c.mainName],
    ['Change', c.updateReason],
    ['Status', c.status],
    ['Date of change', c.dateImported],
  ]),
});

// The cursor is the newest change date seen. Paging stops at a page that holds an older change.
const SaState = z.object({ page: z.number().int().min(0), newest: z.string().nullable() });

const fetchSa = ({ page, since, newestSoFar }: { page: number; since: string | null; newestSoFar: string | null }): ResultAsync<FetchOutcome, SourceError> => {
  const url = `${SA_API}?${new URLSearchParams({ location: 'area', type: 'A', pageSize: String(SA_PAGE_ROWS), offset: String(page * SA_PAGE_ROWS) })}`;
  return getText({ url, headers: SA_HEADERS }).andThen(({ text: body }) => {
    const parsed = SaPage.safeParse(readJsonp(body));
    if (!parsed.success) return parseError(url, parsed.error.message);
    const all = parsed.data.results.map(saChangeRecord);
    const dates = all.map((r) => r.publishedAt).filter((d): d is string => d !== null);
    const newest = [newestSoFar, ...dates].filter((d): d is string => d !== null).sort().at(-1) ?? null;
    const reachedKnown = since !== null && dates.some((d) => d < since);
    const reachedEnd = all.length < SA_PAGE_ROWS || (page + 1) * SA_PAGE_ROWS >= parsed.data.total || (since === null && page + 1 >= SA_FIRST_RUN_PAGES);
    const records = parsed.data.results.filter((c) => isJjr(c.mainName)).map(saChangeRecord);
    return okAsync<FetchOutcome, SourceError>({
      type: 'changed',
      records,
      cursor: newest ?? since,
      raw: [{ name: `changes-${page}.json`, body }],
      next: reachedKnown || reachedEnd ? null : { page: page + 1, newest },
    });
  });
};

export const saLicences: Source = {
  id: 'sa-jjr-licences',
  name: 'SA EPA licence changes (JJ Richards)',
  kind: 'regulatory',
  jurisdiction: 'SA',
  homepage: SA_REGISTER,
  run: ({ cursor, page }) => {
    if (page === null) return fetchSa({ page: 0, since: cursor, newestSoFar: null });
    const state = SaState.safeParse(page);
    return state.success ? fetchSa({ page: state.data.page, since: cursor, newestSoFar: state.data.newest }) : parseError(SA_API, 'The page state is not valid.');
  },
};
