import { inlineText } from './html';

export type HtmlTable = { headers: string[]; rows: string[][] };

const CELL = { th: /<(th)\b[^>]*>([\s\S]*?)<\/th>/gi, any: /<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi };

const cells = (rowHtml: string, kind: keyof typeof CELL) => [...rowHtml.matchAll(CELL[kind])].map((m) => inlineText(m[2] ?? ''));

// Every <table> in the page, with its header cells and body rows as text.
export const readTables = (html: string): HtmlTable[] =>
  [...html.matchAll(/<table\b[\s\S]*?<\/table>/gi)].map((table) => {
    const rows = [...table[0].matchAll(/<tr\b[\s\S]*?<\/tr>/gi)].map((row) => row[0]);
    const headerRow = rows.find((row) => /<th\b/i.test(row)) ?? '';
    return {
      headers: cells(headerRow, 'th'),
      rows: rows.filter((row) => row !== headerRow).map((row) => cells(row, 'any')).filter((row) => row.some((cell) => cell !== '')),
    };
  });
