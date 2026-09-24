import { afterEach, describe, expect, it, vi } from 'vitest';
import { saLicences, vicLicenceRecord } from '../src/sources/licences';
import { nswProsecutions, toRecord as nswProsecution } from '../src/sources/nsw-prosecutions';
import { recordsFromRows, splitPage } from '../src/sources/qld-enforcement';
import { parseSaPage } from '../src/sources/sa-prosecutions';
import { monthPages, parseMonthPage } from '../src/sources/safework-nsw';
import { extractVicDetail } from '../src/sources/vic-court';
import { parseWaPage } from '../src/sources/wa-enforcement';
import { worksafeVic } from '../src/sources/worksafe-vic';

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
    row('STAT-5', { 'Issued To': '' }),
  ]);

  it('groups rows by reference and keeps the first date', () => {
    expect(records).toHaveLength(4);
    expect(records[0]).toMatchObject({ externalId: 'STAT-1', publishedAt: '2024-08-07', party: 'Example Waste Pty Ltd' });
    expect(records[0]?.action).toBe('Direction Notice; Environmental Protection Order (EPO)');
  });
  it('drops a reference with no holder', () => expect(records.map((r) => r.externalId)).not.toContain('STAT-5'));
  it('marks waste activities from the ERA code, but not sewage treatment', () => expect(records.map((r) => r.wasteActivity)).toEqual([true, false, false, true]));
});

describe('QLD page split', () => {
  const full = [...Array.from({ length: 398 }, (_, i) => row(`A${String(i).padStart(3, '0')}`)), row('Z'), row('Z')];
  it('moves a reference that can continue on the next page to that page', () => {
    const { rows, nextOffset } = splitPage({ rows: full, offset: 0, total: 1000 });
    expect(rows).toHaveLength(398);
    expect(nextOffset).toBe(398);
  });
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

const charge = (over: Record<string, unknown> = {}) => ({
  Charge_Description__c: 'Pollute waters',
  Act_Regulation__c: 'Protection of the Environment Operations Act 1997',
  Charge_Section__c: '120',
  Court__c: 'LAND AND ENVIRONMENT COURT',
  Case_Number__c: '2021/47926',
  Result__c: 'Convicted',
  Fine__c: 150000,
  Other_Penalty__c: 'Also ordered to pay investigation costs of $36,926',
  ...over,
});

describe('NSW EPA prosecutions', () => {
  const matter = (charges: ReturnType<typeof charge>[]) => ({ matterId: 'a2P7F00000O0gSOUAZ', defendent: 'CLEANAWAY EQUIPMENT SERVICES PTY LTD ', dateOfCourtSentence: '2022-03-08', matterRecs: charges });
  const record = nswProsecution(matter([charge(), charge({ Charge_Description__c: 'Failure to notify', Fine__c: 187500, Other_Penalty__c: null })]));

  it('adds the fines of all charges', () => expect(record).toMatchObject({ penaltyAud: 337500, publishedAt: '2022-03-08', party: 'CLEANAWAY EQUIPMENT SERVICES PTY LTD' }));
  it('leaves the penalty to Jev when the fine is 0', () => expect(nswProsecution(matter([charge({ Fine__c: 0 })])).penaltyAud).toBeNull());
});

describe('SafeWork NSW', () => {
  const base = 'https://www.safework.nsw.gov.au/compliance-and-prosecutions/prosecutions/years';
  const index = [`${base}/2025-months/december2025`, `${base}/2025/august-2023`, `${base}/2025/may`, `${base}/2026-month/june-2026`, `${base}/2026`, `${base}/2026-month/june-2026`]
    .map((url) => `<a href="${url}">x</a>`)
    .join('');

  it('reads the month from each link, newest first, and skips year pages', () =>
    expect(monthPages(index).map((p) => p.month)).toEqual(['2026-06', '2025-12', '2025-05', '2023-08']));

  const html = `<div id="component_1418754">
<h2>Mulligan Geotechnical Pty Ltd</h2><h3>24 June 2026</h3><p>On 15 March 2023, a worker fell.</p><p>The defendant was fined $225,000.</p>
</div>`;
  const [record] = parseMonthPage({ html, url: `${base}/2026-month/june-2026` });
  it('reads each summary', () =>
    expect(record).toMatchObject({ externalId: '1418754', party: 'Mulligan Geotechnical Pty Ltd', publishedAt: '2026-06-24', body: 'On 15 March 2023, a worker fell.\nThe defendant was fined $225,000.' }));
});

describe('JJ Richards licences', () => {
  it('gives a VIC licence one item for each amendment date', () => {
    const licence = {
      licence_number: 'OL000009923',
      status: 'Issued',
      date_issued: '1996-10-25T10:00:00Z',
      last_amended: '2026-01-21T14:58:12Z',
      permission_activity: 'A01 (Reportable priority waste management)',
      place_or_premises: 'J.J. RICHARDS & SONS PTY LTD [LAVERTON NORTH]',
      premises_address: '166 - 170 Fitzgerald Rd Laverton North VIC 3026 AU',
      acn: '000805425',
    };
    expect(vicLicenceRecord(licence)).toMatchObject({ externalId: 'OL000009923:2026-01-21', publishedAt: '2026-01-21' });
  });

  const change = (over: Record<string, unknown>) => ({
    id: 158869,
    recordNumber: '50003',
    version: 24344970,
    status: 'Issued',
    type: 'LICENCE',
    mainName: 'J.J. RICHARDS & SONS PTY LTD',
    updateReason: 'Authorisation Document Updated',
    dateImported: '28/01/2026',
    ...over,
  });
  describe('SA paging', () => {
    afterEach(() => vi.unstubAllGlobals());
    const page = (results: unknown[]) => `callback(${JSON.stringify({ total: 4502, pageSize: 100, offset: 0, results })})`;
    const full = Array.from({ length: 100 }, (_, i) => change({ recordNumber: String(i), version: i, mainName: i === 5 ? 'J.J. RICHARDS & SONS PTY LTD' : 'OTHER PTY LTD', dateImported: i < 50 ? '24/09/2026' : '20/09/2026' }));

    it('keeps only JJ Richards and stops at a change older than the cursor', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(page(full), { status: 200 })));
      const outcome = (await saLicences.run({ cursor: '2026-09-22', now: new Date('2026-09-24'), page: null, since: null }))._unsafeUnwrap();
      if (outcome.type !== 'changed') throw new Error('Expected records.');
      expect(outcome.records).toHaveLength(1);
      expect(outcome.next).toBeNull();
      expect(outcome.cursor).toBe('2026-09-24');
    });
    it('goes to the next page when all changes are new', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(page(full), { status: 200 })));
      const outcome = (await saLicences.run({ cursor: '2026-09-01', now: new Date('2026-09-24'), page: null, since: null }))._unsafeUnwrap();
      if (outcome.type !== 'changed') throw new Error('Expected records.');
      expect(outcome.next).toEqual({ page: 1, newest: '2026-09-24' });
    });
    it('reads a page that the relay script sends, with no fetch', async () => {
      const fetch = vi.fn();
      vi.stubGlobal('fetch', fetch);
      const outcome = (await saLicences.run({ cursor: '2026-09-22', now: new Date('2026-09-24'), page: { page: 0, newest: null, body: page(full) }, since: null }))._unsafeUnwrap();
      if (outcome.type !== 'changed') throw new Error('Expected records.');
      expect(outcome.records).toHaveLength(1);
      expect(fetch).not.toHaveBeenCalled();
    });
  });
});

describe('NSW EPA prosecutions paging', () => {
  afterEach(() => vi.unstubAllGlobals());
  const matters = Array.from({ length: 350 }, (_, i) => ({
    matterId: `m${String(i).padStart(3, '0')}`,
    defendent: 'EXAMPLE PTY LTD',
    dateOfCourtSentence: i < 10 ? '2026-09-01' : '2015-01-01',
    matterRecs: [charge()],
  }));
  const respond = () => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ returnValue: matters }), { status: 200 })));
  const run = (cursor: string | null, page: unknown) => nswProsecutions.run({ cursor, now: new Date('2026-09-24'), page, since: null });

  it('takes a large response in chunks on the first run', async () => {
    respond();
    const first = (await run(null, null))._unsafeUnwrap();
    if (first.type !== 'changed') throw new Error('Expected records.');
    expect(first.records).toHaveLength(300);
    expect(first.next).toEqual({ index: 0, offset: 300, newest: '2026-09-01' });
    const second = (await run(null, first.next))._unsafeUnwrap();
    if (second.type !== 'changed') throw new Error('Expected records.');
    expect(second.records).toHaveLength(50);
    expect(second.next).toEqual({ index: 1, offset: 0, newest: '2026-09-01' });
  });
  it('reads only the recent matters after the first run', async () => {
    respond();
    const outcome = (await run('2026-09-10', null))._unsafeUnwrap();
    if (outcome.type !== 'changed') throw new Error('Expected records.');
    expect(outcome.records).toHaveLength(10);
  });
});

describe('WorkSafe Victoria paging', () => {
  afterEach(() => vi.unstubAllGlobals());
  const record = (id: number, day: string) => ({ record_id: id, record_title: 'Example Pty Ltd', record_outcome: '', record_prs_dateoutcome: Date.parse(`${day}T12:00:00Z`) / 1000 });

  it('reads again the outcomes that the register adds with an older date', async () => {
    const results = [record(3, '2026-09-20'), record(2, '2026-08-06'), record(1, '2026-01-01')];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ numFound: 3, results }), { status: 200 })));
    const outcome = (await worksafeVic.run({ cursor: '2026-09-10', now: new Date('2026-09-24'), page: null, since: null }))._unsafeUnwrap();
    if (outcome.type !== 'changed') throw new Error('Expected records.');
    expect(outcome.records).toMatchObject([{ externalId: '3' }, { externalId: '2' }]);
    expect(outcome.cursor).toBe('2026-09-20');
    expect(outcome.next).toBeNull();
  });
});
