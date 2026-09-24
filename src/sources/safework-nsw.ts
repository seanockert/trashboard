import { errAsync, okAsync, type ResultAsync } from 'neverthrow';
import { z } from 'zod';
import { datesIn } from './dates';
import { decodeEntities, htmlToText } from './html';
import { getText } from './http';
import type { FetchOutcome, Source, SourceError } from './types';

// SafeWork NSW publishes one page of prosecution summaries for each month.
// The month page addresses do not follow one pattern, thus the first page
// reads them from the index. Each month page is then one invocation.
const INDEX = 'https://www.safework.nsw.gov.au/compliance-and-prosecutions/prosecutions';
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
// SafeWork publishes some months late and can add to a month page, thus a run reads again the months near the newest date seen.
const REREAD_MONTHS = 2;

export type MonthPage = { url: string; month: string };

// "years/2025-months/december2025" is December 2025. "years/2025/august-2023" is August 2023.
// "years/2025/may" has no year in its last part, thus the year comes from the path.
export const monthPages = (html: string): MonthPage[] => {
  const links = [...html.matchAll(/href="(https:\/\/www\.safework\.nsw\.gov\.au\/compliance-and-prosecutions\/prosecutions\/years\/[^"]+)"/g)].map((m) => m[1] ?? '');
  const pages = links.flatMap((url): MonthPage[] => {
    const last = url.split('/').at(-1) ?? '';
    const month = MONTHS.findIndex((name) => last.startsWith(name));
    const year = last.match(/(\d{4})/)?.[1] ?? url.match(/\/years\/(\d{4})/)?.[1];
    return month < 0 || year === undefined ? [] : [{ url, month: `${year}-${String(month + 1).padStart(2, '0')}` }];
  });
  return pages.filter((page, i) => pages.findIndex((other) => other.url === page.url) === i).toSorted((a, b) => b.month.localeCompare(a.month));
};

// Each summary is `<div id="component_N"><h2>party</h2><h3>date</h3><p>...</p></div>`.
export const parseMonthPage = ({ html, url }: { html: string; url: string }) =>
  [...html.matchAll(/<div id="component_(\d+)">\s*<h2>([\s\S]*?)<\/h2>\s*<h3>([\s\S]*?)<\/h3>([\s\S]*?)<\/div>/g)].map((m) => {
    const party = decodeEntities((m[2] ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    return {
      kind: 'enforcement',
      externalId: m[1] ?? '',
      jurisdiction: 'NSW',
      title: `WHS prosecution: ${party}`,
      url: `${url}#component_${m[1]}`,
      publishedAt: datesIn(htmlToText(m[3] ?? ''))[0] ?? null,
      body: htmlToText(m[4] ?? ''),
      party,
      action: 'WHS prosecution',
      location: null,
      penaltyAud: null,
    };
  });

// `newest` is the newest date that the run has seen so far.
const Pages = z.object({ pages: z.array(z.object({ url: z.string(), month: z.string() })), index: z.number().int().min(0), newest: z.string().nullable() });
type Pages = z.infer<typeof Pages>;

const monthOf = (isoDate: string) => isoDate.slice(0, 7);

const minusMonths = (month: string, count: number) => {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - count);
  return monthOf(date.toISOString());
};

const newestOf = (dates: (string | null)[]) => dates.filter((d): d is string => d !== null).sort().at(-1) ?? null;

const fetchMonth = ({ state, cursor }: { state: Pages; cursor: string | null }): ResultAsync<FetchOutcome, SourceError> => {
  const page = state.pages[state.index];
  if (page === undefined) return errAsync({ type: 'parse', url: INDEX, message: 'No month page at this index.' });
  return getText({ url: page.url }).andThen(({ text }) => {
    const records = parseMonthPage({ html: text, url: page.url });
    const newest = newestOf([state.newest, ...records.map((r) => r.publishedAt)]);
    const isLast = state.index + 1 >= state.pages.length;
    return okAsync<FetchOutcome, SourceError>({
      type: 'changed',
      records,
      // The pipeline saves the cursor after the last page only.
      cursor: newestOf([cursor, newest]),
      raw: [{ name: `${page.month}.html`, body: text }],
      next: isLast ? null : { ...state, index: state.index + 1, newest },
    });
  });
};

const fetchIndex = (cursor: string | null) =>
  getText({ url: INDEX }).andThen(({ text }) => {
    const all = monthPages(text);
    if (all.length === 0) return errAsync<FetchOutcome, SourceError>({ type: 'parse', url: INDEX, message: 'The index has no month pages.' });
    const from = cursor === null ? null : minusMonths(monthOf(cursor), REREAD_MONTHS);
    const pages = from === null ? all : all.filter((page) => page.month >= from);
    if (pages.length === 0) return okAsync<FetchOutcome, SourceError>({ type: 'unchanged' });
    return fetchMonth({ state: { pages, index: 0, newest: null }, cursor });
  });

export const safeworkNsw: Source = {
  id: 'safework-nsw',
  name: 'SafeWork NSW prosecutions',
  kind: 'enforcement',
  jurisdiction: 'NSW',
  homepage: INDEX,
  run: ({ cursor, page }) => {
    if (page === null) return fetchIndex(cursor);
    const state = Pages.safeParse(page);
    return state.success ? fetchMonth({ state: state.data, cursor }) : errAsync({ type: 'parse', url: INDEX, message: 'The page state is not valid.' });
  },
};
