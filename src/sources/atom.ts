import { decodeEntities } from './html';

export type AtomEntry = { id: string; title: string; link: string; updated: string | null };

const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1]?.trim() ?? '';

// The legislation feeds give a title, a link and a date. They give no summary.
export const readAtom = (xml: string): AtomEntry[] =>
  [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((m) => {
    const entry = m[0];
    return {
      id: decodeEntities(tag(entry, 'id')),
      title: decodeEntities(tag(entry, 'title')),
      // The feeds put the port in the link, for example "https://host:443/view".
      link: decodeEntities(entry.match(/<link\b[^>]*href="([^"]+)"/i)?.[1] ?? '').replace(/^(https?:\/\/[^/:]+):\d+/, '$1'),
      updated: tag(entry, 'updated').slice(0, 10) || null,
    };
  });
