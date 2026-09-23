import { afterEach, describe, expect, it, vi } from 'vitest';
import { NewItem, type StoredItem } from '../src/items';
import { readAtom } from '../src/sources/atom';
import { nswEpaNews, parseNswEpaList } from '../src/sources/nsw-epa-news';
import { dalExpression, extractPcoText, qldLegislation } from '../src/sources/pco-feeds';
import { newsBody } from '../src/sources/vic-search';
import { snippet } from '../src/web/models';

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

const respond = (body: string) => vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));
const ctx = { cursor: null, now: new Date('2026-09-23'), page: null, since: '2025-09-23T00:00:00.000Z' };

describe('QLD legislation backfill', () => {
  afterEach(() => vi.unstubAllGlobals());
  const record = (id: string, printType: string) => ({
    id: { __value__: id },
    title: { __value__: `Title of ${id}` },
    'publication.date': '2026-09-21T00:00:00',
    'print.type': { __value__: printType },
  });

  it('builds the date filter', () =>
    expect(dalExpression({ printTypes: ['act.new', 'bill.first'], since: ctx.since })).toBe('PrintType=("act.new" OR "bill.first") AND PublicationDate>=20250923000000'));

  it('gives the same IDs and links as the feeds', async () => {
    respond(JSON.stringify({ data: [record('act-2026-021', 'act.new'), record('bill-2026-032', 'bill.first')], totalCount: { __value__: 120 } }));
    const outcome = (await qldLegislation.run(ctx))._unsafeUnwrap();
    if (outcome.type !== 'changed') throw new Error('Expected records.');
    expect(outcome.records).toMatchObject([
      { externalId: 'newlegislation:act-2026-021:2026-09-21', url: 'https://www.legislation.qld.gov.au/view/html/asmade/act-2026-021' },
      { externalId: 'newbills:bill-2026-032:2026-09-21', url: 'https://www.legislation.qld.gov.au/view/html/bill.first/bill-2026-032' },
    ]);
    expect(outcome.next).toBe(51);
  });

  it('reads one record that comes as an object, and stops on the last page', async () => {
    respond(JSON.stringify({ data: record('sl-2026-0136', 'published'), totalCount: { __value__: 101 } }));
    const outcome = (await qldLegislation.run({ ...ctx, page: 101 }))._unsafeUnwrap();
    expect(outcome).toMatchObject({ records: [{ externalId: 'newlegislation:sl-2026-0136:2026-09-21' }], next: null });
  });
});

describe('NSW EPA news backfill', () => {
  afterEach(() => vi.unstubAllGlobals());
  const list = (slugs: string[]) => slugs.map((slug) => `<a href="/news/epamedia/${slug}">Title ${slug}</a>`).join('');

  it('reads the next page while the page is newer than the start date', async () => {
    respond(list(['260921-a', '260806-b']));
    expect((await nswEpaNews.run(ctx))._unsafeUnwrap()).toMatchObject({ next: 1 });
  });
  it('stops at the start date', async () => {
    respond(list(['251001-a', '250901-b']));
    expect((await nswEpaNews.run({ ...ctx, page: 12 }))._unsafeUnwrap()).toMatchObject({ next: null });
  });
  it('reads only the first page in a daily run', async () => {
    respond(list(['260921-a']));
    expect((await nswEpaNews.run({ ...ctx, since: null }))._unsafeUnwrap()).toMatchObject({ next: null });
  });
});

describe('newsBody', () => {
  it('keeps one copy when the text starts with the summary', () => expect(newsBody('EPA fines X.', 'EPA fines X.\nMore text.')).toBe('EPA fines X.\nMore text.'));
  it('keeps both when they differ', () => expect(newsBody('Short.', 'Long text.')).toBe('Short.\nLong text.'));
  it('keeps the summary when there is no text', () => expect(newsBody('Short.', '')).toBe('Short.'));
});

describe('snippet', () => {
  const item = (title: string, body: string) => ({ title, body }) as StoredItem;
  it('hides a body that only repeats the title', () => expect(snippet(item('Waste Act 2026', 'Act: Waste Act 2026 (version 001)'))).toBe(''));
  it('keeps a body with more text', () => expect(snippet(item('Waste Act 2026', 'The Parliament of Queensland enacts— 1 Short title This Act may be cited as the Waste Act 2026.'))).not.toBe(''));
});
