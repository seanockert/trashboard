import { okAsync, type ResultAsync } from 'neverthrow';
import { z } from 'zod';
import { JJR } from '../parties';
import { changed, lines, newestFirstPage, paged, parseError, text } from './common';
import { datesIn } from './dates';
import { BROWSER_USER_AGENT, getJson, getText } from './http';
import type { FetchOutcome, Source, SourceError } from './types';

// Query matches names broadly; code keeps JJ Richards pattern matches.
const isJjr = (name: string) => JJR.pattern.test(name);

const QLD_API = 'https://www.data.qld.gov.au/api/3/action';
const QLD_PACKAGE = `${QLD_API}/package_show?id=environmental-authority-applications`;
const QLD_DATASET = 'https://www.data.qld.gov.au/dataset/environmental-authority-applications';
// PostgreSQL regex: JS pattern not valid in SQL.
const QLD_NAMES = "(j\\.? ?j\\.?''?s? ?richards|jj''s waste|southern oil|createnergy|handybin)";

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

const qldApplicationRecord = (a: QldApplication) => {
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
    const parsed = QldPackage.safeParse(json);
    if (!parsed.success) return parseError(QLD_PACKAGE, parsed.error.message);
    const resource = parsed.data.result.resources.find((r) => r.datastore_active === true);
    if (resource === undefined) return parseError(QLD_PACKAGE, 'No resource with an active datastore.');
    const sql = `SELECT * FROM "${resource.id}" WHERE "Principal Applicant" ~* '${QLD_NAMES}'`;
    const url = `${QLD_API}/datastore_search_sql?${new URLSearchParams({ sql })}`;
    return getJson({ url }).andThen(({ json: rows }) => {
      const found = QldSql.safeParse(rows);
      if (!found.success) return parseError(url, found.error.message);
      return changed({ records: found.data.result.records.filter((a) => isJjr(a['Principal Applicant'])).map(qldApplicationRecord) });
    });
  });

export const qldLicences: Source = {
  id: 'qld-jjr-authorities',
  name: 'QLD environmental authority applications (JJ Richards)',
  kind: 'regulatory',
  homepage: QLD_DATASET,
  run: runQld,
};

// Each amendment date = new item; old items keep history.
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
  return getJson({ url }).andThen(({ json }) => {
    const parsed = VicCollection.safeParse(json);
    if (!parsed.success) return parseError(url, parsed.error.message);
    const records = parsed.data.features
      .map((f) => f.properties)
      .filter((l) => l.acn === JJR_ACN || isJjr(l.place_or_premises))
      .map(vicLicenceRecord);
    return changed({ records });
  });
};

export const vicLicences: Source = {
  id: 'vic-jjr-licences',
  name: 'EPA Victoria operating licences (JJ Richards)',
  kind: 'regulatory',
  homepage: VIC_REGISTER,
  run: runVic,
};

// No name filter: read all recent changes, keep JJ Richards. JSONP. CloudFront blocks Cloudflare: scripts/sa-relay.ts relays pages.
const SA_API = 'https://www.publicregister.epa.sa.gov.au/ajax/records/search';
const SA_REGISTER = 'https://www.publicregister.epa.sa.gov.au/';
const SA_PAGE_ROWS = 100;
const SA_FIRST_RUN_PAGES = 17;
// CloudFront refuses Accept without JavaScript.
const SA_HEADERS = { 'user-agent': BROWSER_USER_AGENT, accept: 'application/json, text/javascript, */*' };

const SaChange = z.object({ id: z.number(), recordNumber: z.string(), version: z.number(), status: text, type: text, mainName: text, updateReason: text, dateImported: text });
type SaChange = z.infer<typeof SaChange>;
const SaPage = z.object({ total: z.number(), results: z.array(SaChange) });

const readJsonp = (body: string): unknown => {
  try {
    return JSON.parse(body.slice(body.indexOf('(') + 1, body.lastIndexOf(')')));
  } catch {
    return null;
  }
};

const saChangeRecord = (c: SaChange) => ({
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

// Date is import date: no reread needed.
export const SaState = z.object({ page: z.number().int().min(0), newest: z.string().nullable(), body: z.string().optional() });

export const saPageUrl = (page: number) =>
  `${SA_API}?${new URLSearchParams({ location: 'area', type: 'A', pageSize: String(SA_PAGE_ROWS), offset: String(page * SA_PAGE_ROWS) })}`;

const fetchSa = ({ page, cursor, newestSoFar, relayed }: { page: number; cursor: string | null; newestSoFar: string | null; relayed: string | undefined }): ResultAsync<FetchOutcome, SourceError> => {
  const url = saPageUrl(page);
  const response: ResultAsync<{ text: string }, SourceError> = relayed === undefined ? getText({ url, headers: SA_HEADERS }) : okAsync({ text: relayed });
  return response.andThen(({ text: body }) => {
    const parsed = SaPage.safeParse(readJsonp(body));
    if (!parsed.success) return parseError(url, parsed.error.message);
    const rows = parsed.data.results;
    const { fresh, newest, reachedKnown } = newestFirstPage({ rows, dateOf: (c) => datesIn(c.dateImported)[0] ?? null, cursor, newestSoFar, rereadDays: 0 });
    const reachedEnd = rows.length < SA_PAGE_ROWS || (page + 1) * SA_PAGE_ROWS >= parsed.data.total || (cursor === null && page + 1 >= SA_FIRST_RUN_PAGES);
    return changed({ records: fresh.filter((c) => isJjr(c.mainName)).map(saChangeRecord), cursor: newest, next: reachedKnown || reachedEnd ? null : { page: page + 1, newest } });
  });
};

export const saLicences: Source = {
  id: 'sa-jjr-licences',
  name: 'SA EPA licence changes (JJ Richards)',
  kind: 'regulatory',
  homepage: SA_REGISTER,
  run: paged({
    url: SA_API,
    state: SaState,
    first: ({ cursor }) => fetchSa({ page: 0, cursor, newestSoFar: null, relayed: undefined }),
    next: (state, { cursor }) => fetchSa({ page: state.page, cursor, newestSoFar: state.newest, relayed: state.body }),
  }),
  manualOnly: true,
};
