// Plain text from server-rendered HTML. Block tags become line breaks.

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '-', mdash: '-', hellip: '…' };

// A numeric entity that is not a valid code point stays as it is.
const fromCodePoint = (point: number, whole: string) => (point <= 0x10ffff ? String.fromCodePoint(point) : whole);

export const decodeEntities = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X')) return fromCodePoint(parseInt(code.slice(2), 16), whole);
    if (code.startsWith('#')) return fromCodePoint(Number(code.slice(1)), whole);
    return ENTITIES[code.toLowerCase()] ?? whole;
  });

export const htmlToText = (html: string) =>
  decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|nav|header|footer|form)[\s\S]*?<\/\1>/gi, '')
      .replace(/<\/?(p|div|br|li|ul|ol|h[1-6]|tr|td|th|table|section|article|dt|dd)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n');

// One line of text, for example from a table cell or a link.
export const inlineText = (html: string) => decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

// The HTML between the first match of `start` and the first match of `end` after it.
export const between = ({ html, start, end }: { html: string; start: RegExp; end: RegExp }) => {
  const from = html.search(start);
  if (from < 0) return '';
  const rest = html.slice(from);
  const to = rest.search(end);
  return to < 0 ? rest : rest.slice(0, to);
};

// The text of the <main> element of a page.
export const mainText = (html: string) => htmlToText(between({ html, start: /<main[\s>]/i, end: /<\/main>/i }));
