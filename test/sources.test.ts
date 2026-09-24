import { describe, expect, it } from 'vitest';
import { NewItem } from '../src/items';
import { recordsFromRows, splitPage } from '../src/sources/qld-enforcement';
import { parseSaPage } from '../src/sources/sa-prosecutions';
import { extractVicDetail } from '../src/sources/vic-court';
import { parseWaPage } from '../src/sources/wa-enforcement';

const row = (ref: string, over: Partial<Record<string, string>> = {}) => ({
  'Enforcement Reference': ref,
  'Enforcement Type': 'Direction Notice',
  'Issued To': 'Example Waste Pty Ltd',
  'Issued Date': '2024-08-07 00:00:00',
  Status: 'Closed',
  Activities: '',
  Locations: 'Lot 1',
  'Related Environmental Authority': '',
  'Subsequent Action': '',
  ...over,
});

describe('QLD enforcement register', () => {
  const records = recordsFromRows([
    row('STAT-1', { Activities: 'ERA 60 - Waste disposal' }),
    row('STAT-1', { 'Enforcement Type': 'Environmental Protection Order (EPO)', 'Issued Date': '2024-11-05 00:00:00', Status: 'Open' }),
    row('STAT-2', { 'Enforcement Type': 'Clean-up Notice', Activities: 'ERA 16 - Extractive activities' }),
    row('STAT-3', { Activities: 'ERA 63 - Sewage Treatment' }),
    row('STAT-4', { Activities: 'ERA 62 - Resource recovery and transfer facility operation' }),
  ]);

  it('groups rows by reference and keeps the first date', () => {
    expect(records).toHaveLength(4);
    expect(records[0]).toMatchObject({ externalId: 'STAT-1', publishedAt: '2024-08-07', party: 'Example Waste Pty Ltd' });
    expect(records[0]?.action).toBe('Direction Notice; Environmental Protection Order (EPO)');
  });
  it('marks waste activities from the ERA code, but not sewage treatment', () => expect(records.map((r) => r.wasteActivity)).toEqual([true, false, false, true]));
  it('gives valid items', () => records.forEach((r) => expect(NewItem.safeParse(r).success).toBe(true)));
});

describe('QLD page split', () => {
  const full = [...Array.from({ length: 398 }, (_, i) => row(`A${String(i).padStart(3, '0')}`)), row('Z'), row('Z')];
  it('moves a reference that can continue on the next page to that page', () => {
    const { rows, nextOffset } = splitPage({ rows: full, offset: 0, total: 1000 });
    expect(rows).toHaveLength(398);
    expect(nextOffset).toBe(398);
  });
  it('keeps all rows on the last page', () => expect(splitPage({ rows: full.slice(0, 10), offset: 400, total: 410 })).toMatchObject({ nextOffset: null }));
});

describe('WA enforcement page', () => {
  const html = `
    <table><tr><th>Offender</th><th>Date of offence</th><th>Address</th><th>Charges</th><th>Summary</th><th>Date of conviction</th><th>Penalty</th><th>Legal costs*</th><th>Other costs*</th><th>Media statements</th></tr>
    <tr><td>Example Waste Pty Ltd</td><td>01/02/2024</td><td>Perth</td><td>s 50B</td><td>Leachate released</td><td>Convicted 17/6/25 Sentenced 22/08/25</td><td>$3750 $11,250</td><td>N/A</td><td>N/A</td><td></td></tr>
    <tr><td>Example Waste Pty Ltd</td><td>01/02/2024</td><td>Perth</td><td>s 50B</td><td>Second charge</td><td>Convicted 17/6/25 Sentenced 22/08/25</td><td>$1,000</td><td>N/A</td><td>N/A</td><td></td></tr></table>
    <table><tr><th>Date of issue</th><th>VCN number</th><th>Person to whom VCN given</th></tr><tr><td>01/01/2025</td><td>V1</td><td>Farm Pty Ltd</td></tr></table>`;
  const records = parseWaPage(html);

  it('reads prosecutions and skips vegetation notices', () => expect(records.map((r) => r.action)).toEqual(['Prosecution', 'Prosecution']));
  it('makes repeated IDs unique', () => expect(new Set(records.map((r) => r.externalId)).size).toBe(2));
  it('takes the sentence date and adds the fines', () => expect(records[0]).toMatchObject({ publishedAt: '2025-08-22', penaltyAud: 15000 }));
});

describe('SA prosecutions page', () => {
  const html = `<table><tr><th>Offender</th><th>Incident</th><th>Outcome</th></tr>
    <tr><td>Example Water Corporation Ltd</td><td>May 2023 Turbid water released.</td><td>12 September 2025 In the ERD Court the company was fined $60,000.</td></tr></table>`;
  it('reads the outcome date', () => expect(parseSaPage(html)[0]).toMatchObject({ publishedAt: '2025-09-12', action: 'Prosecution' }));
});

describe('VIC court detail page', () => {
  const html = `<header>Menu</header><main><h1>Example Pty Ltd</h1><h2>Date of offence or contravention</h2><p>1 May 2024</p>
    <h2>Court orders made</h2><p>Fine of $10,000.</p><p>Updated</p><p>14 September 2026</p></main><footer>Links</footer>`;
  it('keeps the text from the offence date to the orders', () =>
    expect(extractVicDetail(html)).toBe('Date of offence or contravention\n1 May 2024\nCourt orders made\nFine of $10,000.'));
});
