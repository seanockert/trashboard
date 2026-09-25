import type { ResultAsync } from 'neverthrow';
import { z } from 'zod';
import { isCompanyName } from '../parties';
import { changed, paged, parseError, text } from './common';
import { htmlToText, mainText } from './html';
import { getJson, getText, postJson } from './http';
import type { FetchOutcome, Source, SourceError } from './types';

// Undocumented "load more" JSON. 8457 = open-projects list block. Close date is on project page.
const NSW_SITE = 'https://yoursay.epa.nsw.gov.au';
const NSW_OPEN_LIST = `${NSW_SITE}/ccm/the_hive_projects/tools/the_hive_projects_list/load_more/8457?page=1`;

const NswProject = z.object({ projectID: z.number(), projectName: z.string().min(1), projectDescription: text, projectPath: z.url(), projectDateNum: text });
type NswProject = z.infer<typeof NswProject>;
const NswList = z.object({ result: z.array(NswProject) });

const nswProjectRecord = (p: NswProject) => ({
  kind: 'regulatory',
  externalId: String(p.projectID),
  jurisdiction: 'NSW',
  title: p.projectName,
  url: p.projectPath,
  publishedAt: p.projectDateNum || null,
  body: `Consultation by the NSW EPA.\n${p.projectDescription}`,
  detailUrl: p.projectPath,
});

export const nswEpaYourSay: Source = {
  id: 'nsw-epa-yoursay',
  name: 'NSW EPA Your Say consultations',
  kind: 'regulatory',
  homepage: NSW_SITE,
  prose: true,
  extractDetail: mainText,
  run: () =>
    getJson({ url: NSW_OPEN_LIST }).andThen(({ json }) => {
      const parsed = NswList.safeParse(json);
      if (!parsed.success) return parseError(NSW_OPEN_LIST, parsed.error.message);
      return changed({ records: parsed.data.result.map(nswProjectRecord) });
    }),
};

// Inertia app, undocumented. Version header must match home page version.
const VIC_SITE = 'https://engage.vic.gov.au';
const VIC_MAX_PAGES = 5;

const Stage = z.object({ title: text, date_start: text, date_end: text });
const VicProject = z.object({
  id: z.number(),
  title: z.string().min(1),
  summary: text,
  description: text,
  url: z.url(),
  created_at: text,
  team: z.object({ name: text }).nullish(),
  public_stages: z.array(Stage).nullish(),
});
type VicProject = z.infer<typeof VicProject>;
const VicPage = z.object({ props: z.object({ meta: z.object({ current_page: z.number(), last_page: z.number(), data: z.array(VicProject) }) }) });

const stageLine = (s: z.infer<typeof Stage>) => `${s.title}: ${[s.date_start, s.date_end].filter((d) => d !== '').join(' to ')}`;

// Stages first: they hold dates, body is truncated.
const vicProjectRecord = (p: VicProject) => ({
  kind: 'regulatory',
  externalId: String(p.id),
  jurisdiction: 'VIC',
  title: p.title,
  url: p.url,
  publishedAt: p.created_at.slice(0, 10) || null,
  body: [
    `Consultation by ${p.team?.name || 'the Victorian Government'}.`,
    ...(p.public_stages ?? []).map(stageLine),
    p.summary,
    htmlToText(p.description),
  ]
    .filter((line) => line !== '')
    .join('\n'),
});

// Applicant is in title. Drop applications that name a person.
export const namesPerson = (p: VicProject) => {
  const applicant = p.title.match(/^(.+?)\s*\(APP\d+\)\s*$/)?.[1];
  return applicant !== undefined && !isCompanyName(applicant);
};

export const inertiaVersion = (html: string) => html.match(/&quot;version&quot;:&quot;([0-9a-f]+)&quot;/)?.[1] ?? null;

const VicState = z.object({ page: z.number().int().min(1), version: z.string() });
type VicState = z.infer<typeof VicState>;

const fetchVicPage = (state: VicState): ResultAsync<FetchOutcome, SourceError> => {
  const url = `${VIC_SITE}/project?${new URLSearchParams({ page: String(state.page), 'filter[status]': 'open' })}`;
  return getJson({ url, headers: { 'x-inertia': 'true', 'x-inertia-version': state.version, 'x-requested-with': 'XMLHttpRequest' } }).andThen(({ json }) => {
    const parsed = VicPage.safeParse(json);
    if (!parsed.success) return parseError(url, parsed.error.message);
    const { current_page, last_page, data } = parsed.data.props.meta;
    const isLast = current_page >= last_page || current_page >= VIC_MAX_PAGES;
    return changed({ records: data.filter((p) => !namesPerson(p)).map(vicProjectRecord), next: isLast ? null : { ...state, page: state.page + 1 } });
  });
};

export const engageVic: Source = {
  id: 'engage-vic',
  name: 'Engage Victoria consultations',
  kind: 'regulatory',
  homepage: VIC_SITE,
  prose: true,
  run: paged({
    url: VIC_SITE,
    state: VicState,
    first: () =>
      getText({ url: VIC_SITE }).andThen(({ text: html }) => {
        const version = inertiaVersion(html);
        return version === null ? parseError(VIC_SITE, 'No Inertia version in the home page.') : fetchVicPage({ page: 1, version });
      }),
    next: fetchVicPage,
  }),
};

const sydneyDay = (isoTime: string) =>
  new Date(isoTime).toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'long', year: 'numeric' });

const CTH_API = 'https://au.system.converlens.com/projects/au_climate/search';
const CTH_SITE = 'https://consult.dcceew.gov.au';
const CTH_ORG = 'org20ee740c8b3c21feb3566';

const CthProject = z.object({ id: z.string().min(1), key: z.string().min(1), title: z.string().min(1), description: text, starts: z.string().nullish(), ends: z.string().nullish() });
type CthProject = z.infer<typeof CthProject>;
const CthPage = z.object({ data: z.array(CthProject) });

const periodLine = ({ starts, ends }: { starts: string | null; ends: string | null }) =>
  `Consultation period: ${[starts, ends].filter((d): d is string => d !== null).join(' to ')}`;

export const cthProjectRecord = (p: CthProject) => ({
  kind: 'regulatory',
  externalId: p.id,
  jurisdiction: 'CTH',
  title: p.title,
  url: `${CTH_SITE}/${p.key}`,
  publishedAt: p.starts ? new Date(p.starts).toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' }) : null,
  body: [
    'Consultation by the Department of Climate Change, Energy, the Environment and Water.',
    periodLine({ starts: p.starts ? sydneyDay(p.starts) : null, ends: p.ends ? sydneyDay(p.ends) : null }),
    htmlToText(p.description),
  ]
    .filter((line) => line !== '')
    .join('\n'),
});

export const dcceewConsultations: Source = {
  id: 'dcceew-consult',
  name: 'DCCEEW consultation hub',
  kind: 'regulatory',
  homepage: CTH_SITE,
  prose: true,
  run: () => {
    const request = { org_id: CTH_ORG, labels: [], status: 'open', limit: 100, page: 1, sort: '-ends' };
    return postJson({ url: CTH_API, body: request }).andThen(({ json }) => {
      const parsed = CthPage.safeParse(json);
      if (!parsed.success) return parseError(CTH_API, parsed.error.message);
      return changed({ records: parsed.data.data.map(cthProjectRecord) });
    });
  },
};

const WA_API = 'https://consult.dwer.wa.gov.au/api/2.4/json_search_results?fields=extended';
const WA_SITE = 'https://consult.dwer.wa.gov.au';

const WaConsultation = z.object({ id: z.string().min(1), dept: z.string().min(1), title: z.string().min(1), url: z.url(), overview: text, startdate: text, enddate: text, department: text });
type WaConsultation = z.infer<typeof WaConsultation>;

const waDay = (date: string) => {
  const m = date.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  return m === null ? null : `${m[1]}-${m[2]}-${m[3]}`;
};

export const waConsultationRecord = (c: WaConsultation) => {
  const starts = waDay(c.startdate);
  const ends = waDay(c.enddate);
  const words = (day: string | null) => (day === null ? null : sydneyDay(`${day}T12:00:00+10:00`));
  return {
    kind: 'regulatory',
    externalId: `${c.dept}/${c.id}`,
    jurisdiction: 'WA',
    title: c.title,
    url: c.url,
    publishedAt: starts,
    body: [`Consultation by the Department of Water and Environmental Regulation (${c.department}).`, periodLine({ starts: words(starts), ends: words(ends) }), htmlToText(c.overview)]
      .filter((line) => line !== '')
      .join('\n'),
  };
};

export const dwerConsultations: Source = {
  id: 'dwer-consult',
  name: 'WA DWER consultations',
  kind: 'regulatory',
  homepage: WA_SITE,
  prose: true,
  run: () =>
    getJson({ url: WA_API }).andThen(({ json }) => {
      const parsed = z.array(WaConsultation).safeParse(json);
      if (!parsed.success) return parseError(WA_API, parsed.error.message);
      return changed({ records: parsed.data.map(waConsultationRecord) });
    }),
};
