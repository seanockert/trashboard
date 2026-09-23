import { describe, expect, it } from 'vitest';
import { NewItem } from '../src/items';
import { readAtom } from '../src/sources/atom';
import { parseNswEpaList } from '../src/sources/nsw-epa-news';
import { extractPcoText } from '../src/sources/pco-feeds';

describe('readAtom', () => {
  const xml = `<feed><entry><title type="html">Waste Reduction and Recycling Amendment Act 2026 &amp; more</title>
    <link rel="alternate" href="https://www.legislation.qld.gov.au:443/view/html/asmade/act-2026-021" />
    <id>act-2026-021</id><updated>2026-09-21T00:00:00+10:00</updated></entry></feed>`;
  it('reads the entry and removes the port from the link', () =>
    expect(readAtom(xml)).toEqual([
      { id: 'act-2026-021', title: 'Waste Reduction and Recycling Amendment Act 2026 & more', link: 'https://www.legislation.qld.gov.au/view/html/asmade/act-2026-021', updated: '2026-09-21' },
    ]));
});

describe('extractPcoText', () => {
  it('starts at the law text, after the table of contents', () =>
    expect(extractPcoText('<div class="toc">Contents</div><div id="fragview"><p>1 Short title</p><p>This Act may be cited as X.</p></div><footer>Copyright</footer>')).toBe(
      '1 Short title\nThis Act may be cited as X.',
    ));
});

describe('parseNswEpaList', () => {
  const html = `<a href="/news/epamedia/260921-solar-mandate" class="x">NSW leads with <b>solar</b> mandate</a>
    <a href="/news/epamedia/260921-solar-mandate">NSW leads with solar mandate</a>
    <a href="/news/epamedia/260917-river"><img src="x.jpg"></a>`;
  const items = parseNswEpaList(html);
  it('keeps one item for each link that has a title', () => expect(items.map((i) => i.externalId)).toEqual(['260921-solar-mandate']));
  it('takes the date from the link', () => expect(items[0]).toMatchObject({ publishedAt: '2026-09-21', title: 'NSW leads with solar mandate' }));
  it('gives valid items', () => expect(NewItem.safeParse(items[0]).success).toBe(true));
});
