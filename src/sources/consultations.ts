import { errAsync, okAsync, type ResultAsync } from 'neverthrow';
import { z } from 'zod';
import { between, htmlToText } from './html';
import { getJson, getText, postJson } from './http';
import type { FetchOutcome, Source, SourceError } from './types';

// Public consultations. Each one is a regulatory item. The close date is
// free text on these sites, thus the body starts with the text that holds
// the dates, and Jev selects the close date as for other items.

const parseError = (url: string, message: string) => errAsync<FetchOutcome, SourceError>({ type: 'parse', url, message: message.slice(0, 500) });

// NSW EPA Your Say. The list of open projects is the JSON that the "load
// more" button of the site gets. It is not a documented API. 8457 is the ID
// of the list block for open projects. The close date is on each project
// page, thus the pipeline fetches that page as the item detail.
const NSW_SITE = 'https://yoursay.epa.nsw.gov.au';
const NSW_OPEN_LIST = `${NSW_SITE}/ccm/the_hive_projects/tools/the_hive_projects_list/load_more/8457?page=1`;

const text = z.string().nullish().transform((value) => (value ?? '').trim());
const NswProject = z.object({ projectID: z.number(), projectName: z.string().min(1), projectDescription: text, projectPath: z.url(), projectDateNum: text });
type NswProject = z.infer<typeof NswProject>;
const NswList = z.object({ result: z.array(NswProject) });

export const nswProjectRecord = (p: NswProject) => ({
  kind: 'regulatory',
  externalId: String(p.projectID),
  jurisdiction: 'NSW',
  title: p.projectName,
  url: p.projectPath,
  // The list gives the date of the last change to the project. A change also makes the item fetch its page again.
  publishedAt: p.projectDateNum || null,
  body: `Consultation by the NSW EPA.\n${p.projectDescription}`,
  detailUrl: p.projectPath,
});

// The main part of a project page. It holds the "Have your say" text with the close date.
export const extractNswProject = (html: string) => htmlToText(between({ html, start: /<main[\s>]/i, end: /<\/main>/i }));

export const nswEpaYourSay: Source = {
  id: 'nsw-epa-yoursay',
  name: 'NSW EPA Your Say consultations',
  kind: 'regulatory',
  jurisdiction: 'NSW',
  homepage: NSW_SITE,
  extractDetail: extractNswProject,
  run: () =>
    getJson({ url: NSW_OPEN_LIST }).andThen(({ json, text: body }) => {
      const parsed = NswList.safeParse(json);
      if (!parsed.success) return parseError(NSW_OPEN_LIST, parsed.error.message);
      return okAsync<FetchOutcome, SourceError>({
        type: 'changed',
        records: parsed.data.result.map(nswProjectRecord),
        cursor: null,
        raw: [{ name: 'open.json', body }],
        next: null,
      });
    }),
};

// Engage Victoria, which EPA Victoria also uses. The site is an Inertia app:
// a request with the Inertia headers gets the page data as JSON. The version
// header must match the version in the home page. It is not a documented API.
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

// The stages come first, because they hold the dates and the body is truncated.
export const vicProjectRecord = (p: VicProject) => ({
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

// The version is in the JSON of the `data-page` attribute, with HTML entities.
export const inertiaVersion = (html: string) => html.match(/&quot;version&quot;:&quot;([0-9a-f]+)&quot;/)?.[1] ?? null;

const VicState = z.object({ page: z.number().int().min(1), version: z.string() });
type VicState = z.infer<typeof VicState>;

const fetchVicPage = (state: VicState): ResultAsync<FetchOutcome, SourceError> => {
  const url = `${VIC_SITE}/project?${new URLSearchParams({ page: String(state.page), 'filter[status]': 'open' })}`;
  return getJson({ url, headers: { 'x-inertia': 'true', 'x-inertia-version': state.version, 'x-requested-with': 'XMLHttpRequest' } }).andThen(({ json, text: body }) => {
    const parsed = VicPage.safeParse(json);
    if (!parsed.success) return parseError(url, parsed.error.message);
    const { current_page, last_page, data } = parsed.data.props.meta;
    const isLast = current_page >= last_page || current_page >= VIC_MAX_PAGES;
    return okAsync<FetchOutcome, SourceError>({
      type: 'changed',
      records: data.map(vicProjectRecord),
      cursor: null,
      raw: [{ name: `open-${state.page}.json`, body }],
      next: isLast ? null : { ...state, page: state.page + 1 },
    });
  });
};

export const engageVic: Source = {
  id: 'engage-vic',
  name: 'Engage Victoria consultations',
  kind: 'regulatory',
  jurisdiction: 'VIC',
  homepage: VIC_SITE,
  run: ({ page }) => {
    if (page !== null) {
      const state = VicState.safeParse(page);
      return state.success ? fetchVicPage(state.data) : parseError(VIC_SITE, 'The page state is not valid.');
    }
    return getText({ url: VIC_SITE }).andThen(({ text: html }) => {
      const version = inertiaVersion(html);
      return version === null ? parseError(VIC_SITE, 'No Inertia version in the home page.') : fetchVicPage({ page: 1, version });
    });
  },
};

// The day in Sydney of an ISO time, in words, for example "23 October 2026".
// The date step reads dates in words, as on the other consultation sites.
export const sydneyDay = (isoTime: string) =>
  new Date(isoTime).toLocaleDateString('en-AU', { timeZone: 'Australia/Sydney', day: 'numeric', month: 'long', year: 'numeric' });

// DCCEEW (Commonwealth). The consultation hub is a Converlens site. This is
// the search call of the hub page. It is not a documented API.
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
  jurisdiction: 'CTH',
  homepage: CTH_SITE,
  run: () => {
    const request = { org_id: CTH_ORG, labels: [], status: 'open', limit: 100, page: 1, sort: '-ends' };
    return postJson({ url: CTH_API, body: request }).andThen(({ json, text: body }) => {
      const parsed = CthPage.safeParse(json);
      if (!parsed.success) return parseError(CTH_API, parsed.error.message);
      return okAsync<FetchOutcome, SourceError>({ type: 'changed', records: parsed.data.data.map(cthProjectRecord), cursor: null, raw: [{ name: 'open.json', body }], next: null });
    });
  },
};

// WA DWER. A Citizen Space site with its documented search API. It gives
// every consultation in one response, about 40 in total.
const WA_API = 'https://consult.dwer.wa.gov.au/api/2.4/json_search_results?fields=extended';
const WA_SITE = 'https://consult.dwer.wa.gov.au';

const WaConsultation = z.object({ id: z.string().min(1), dept: z.string().min(1), title: z.string().min(1), url: z.url(), overview: text, startdate: text, enddate: text, department: text });
type WaConsultation = z.infer<typeof WaConsultation>;

// Citizen Space dates are "2026/08/18".
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
    // The consultation ID is unique within its workspace.
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
  jurisdiction: 'WA',
  homepage: WA_SITE,
  run: () =>
    getJson({ url: WA_API }).andThen(({ json, text: body }) => {
      const parsed = z.array(WaConsultation).safeParse(json);
      if (!parsed.success) return parseError(WA_API, parsed.error.message);
      return okAsync<FetchOutcome, SourceError>({ type: 'changed', records: parsed.data.map(waConsultationRecord), cursor: null, raw: [{ name: 'all.json', body }], next: null });
    }),
};
