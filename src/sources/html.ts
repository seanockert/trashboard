// Plain text from server-rendered HTML. Block tags become line breaks.

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '-', mdash: '-', hellip: '…' };

export const decodeEntities = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, code: string) => {
    if (code.startsWith('#x') || code.startsWith('#X')) return String.fromCodePoint(parseInt(code.slice(2), 16));
    if (code.startsWith('#')) return String.fromCodePoint(Number(code.slice(1)));
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

// The HTML between the first match of `start` and the first match of `end` after it.
export const between = ({ html, start, end }: { html: string; start: RegExp; end: RegExp }) => {
  const from = html.search(start);
  if (from < 0) return '';
  const rest = html.slice(from);
  const to = rest.search(end);
  return to < 0 ? rest : rest.slice(0, to);
};
