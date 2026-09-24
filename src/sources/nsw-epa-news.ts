import { z } from 'zod';
import { changed, uniqueBy } from './common';
import { inlineText, mainText } from './html';
import { getText } from './http';
import type { Source } from './types';

const SITE = 'https://www.epa.nsw.gov.au';
const LIST = `${SITE}/news`;
// A list page holds about one month of releases. This limit stops a backfill
// if the page links stop having dates.
const MAX_PAGES = 30;

// Links look like "/news/epamedia/260921-slug". The first six digits are the date.
const dateFromSlug = (slug: string) => {
  const m = slug.match(/^(\d{2})(\d{2})(\d{2})-/);
  return m === null ? null : `20${m[1]}-${m[2]}-${m[3]}`;
};

export const parseNswEpaList = (html: string) => {
  const links = [...html.matchAll(/<a\s+href="(\/news\/epamedia\/([^"]+))"[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => ({
    path: m[1] ?? '',
    slug: m[2] ?? '',
    title: inlineText(m[3] ?? ''),
  }));
  return uniqueBy(
    links.filter((link) => link.title !== ''),
    (link) => link.path,
  ).map((link) => ({
    kind: 'regulatory',
    externalId: link.slug,
    jurisdiction: 'NSW',
    title: link.title,
    url: `${SITE}${link.path}`,
    publishedAt: dateFromSlug(link.slug),
    body: '',
    detailUrl: `${SITE}${link.path}`,
  }));
};

export const nswEpaNews: Source = {
  id: 'nsw-epa-news',
  name: 'NSW EPA news and media releases',
  kind: 'regulatory',
  jurisdiction: 'NSW',
  homepage: LIST,
  extractDetail: mainText,
  // A daily run reads the first page. A backfill reads the pages after it, to its start date.
  run: ({ page, since }) => {
    const index = z.number().catch(0).parse(page ?? 0);
    return getText({ url: index === 0 ? LIST : `${LIST}?page=${index}` }).andThen(({ text }) => {
      const records = parseNswEpaList(text);
      const oldest = records.flatMap((r) => (r.publishedAt === null ? [] : [r.publishedAt])).sort()[0];
      const more = since !== null && oldest !== undefined && oldest > since.slice(0, 10) && index + 1 < MAX_PAGES;
      return changed({ records, next: more ? index + 1 : null });
    });
  },
};
