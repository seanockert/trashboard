import { between, decodeEntities, htmlToText } from './html';
import { getText } from './http';
import type { Source } from './types';

const SITE = 'https://www.epa.nsw.gov.au';
const LIST = `${SITE}/news`;

// Links look like "/news/epamedia/260921-slug". The first six digits are the date.
const dateFromSlug = (slug: string) => {
  const m = slug.match(/^(\d{2})(\d{2})(\d{2})-/);
  return m === null ? null : `20${m[1]}-${m[2]}-${m[3]}`;
};

export const parseNswEpaList = (html: string) => {
  const links = [...html.matchAll(/<a\s+href="(\/news\/epamedia\/([^"]+))"[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => ({
    path: m[1] ?? '',
    slug: m[2] ?? '',
    title: decodeEntities((m[3] ?? '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim(),
  }));
  const unique = links.filter((link, i) => link.title !== '' && links.findIndex((l) => l.path === link.path) === i);
  return unique.map((link) => ({
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

export const extractNswEpaArticle = (html: string) => htmlToText(between({ html, start: /<main[\s>]/i, end: /<\/main>/i }));

export const nswEpaNews: Source = {
  id: 'nsw-epa-news',
  name: 'NSW EPA news and media releases',
  kind: 'regulatory',
  jurisdiction: 'NSW',
  homepage: LIST,
  extractDetail: extractNswEpaArticle,
  run: () => getText({ url: LIST }).map(({ text }) => ({ type: 'changed' as const, records: parseNswEpaList(text), cursor: null, next: null, raw: [] })),
};
