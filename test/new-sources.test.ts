import { afterEach, describe, expect, it, vi } from 'vitest';
import { NewItem } from '../src/items';
import { qldApplicationRecord, readJsonp, saChangeRecord, saLicences, vicLicenceRecord } from '../src/sources/licences';
import { nswProsecutions, toRecord as nswProsecution } from '../src/sources/nsw-prosecutions';
import { monthPages, parseMonthPage } from '../src/sources/safework-nsw';
import { toRecord as worksafeRecord } from '../src/sources/worksafe-vic';

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
  it('puts one line for each charge in the body', () => {
    expect(record.body.split('\n')).toHaveLength(2);
    expect(record.body).toContain('Charge: Pollute waters (Protection of the Environment Operations Act 1997 s 120) Court: LAND AND ENVIRONMENT COURT. Result: Convicted. Fine: $150,000.');
  });
  it('leaves the penalty to Jev when the fine is 0', () => expect(nswProsecution(matter([charge({ Fine__c: 0 })])).penaltyAud).toBeNull());
  it('gives valid items', () => expect(NewItem.safeParse(record).success).toBe(true));
});

describe('WorkSafe Victoria', () => {
  const record = worksafeRecord({
    record_id: 168756,
    record_title: 'Optibelt Australia Pty Ltd',
    record_outcome: '<p>The company pleaded guilty &amp; was fined $40,000.</p>',
    record_prs_dateoutcome: 1789500000,
    data: { attributes: { field_prs_type: 'PRS' } },
  });
  it('reads the record', () =>
    expect(record).toMatchObject({ externalId: '168756', url: 'https://www.worksafe.vic.gov.au/record/168756', body: 'The company pleaded guilty & was fined $40,000.', action: 'WHS prosecution' }));
  it('gives the outcome date', () => expect(record.publishedAt).toBe('2026-09-15'));
  it('gives valid items', () => expect(NewItem.safeParse(record).success).toBe(true));
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
  it('gives valid items', () => expect(NewItem.safeParse(record).success).toBe(true));
});

describe('JJ Richards licences', () => {
  it('reads a QLD application', () => {
    const record = qldApplicationRecord({
      'Application Number': 'A-EA-AMD-101149438',
      'Application Action': 'Amend',
      'Principal Applicant': 'J.J. RICHARDS & SONS PTY LTD',
      'Application Date': '2026-07-23T00:00:00',
      'Application Status': 'Assessment',
      Activities: 'ERA 54 - Mechanical waste reprocessing',
      Locations: '',
      'Related Permit': 'EPPR00328413',
      'Permit Version': 3,
      'Permit Status': 'Granted',
      'Permit Effective Date': '',
    });
    expect(record).toMatchObject({ publishedAt: '2026-07-23', title: 'QLD environmental authority amendment application A-EA-AMD-101149438: J.J. RICHARDS & SONS PTY LTD (Assessment)' });
    expect(record.body).toContain('Permit version: 3');
    expect(NewItem.safeParse(record).success).toBe(true);
  });

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
    expect(NewItem.safeParse(vicLicenceRecord(licence)).success).toBe(true);
  });

  it('reads JSONP', () => expect(readJsonp('callback({"total":1})')).toEqual({ total: 1 }));
  it('gives null for a body that is not JSONP', () => expect(readJsonp('<html>Not Acceptable</html>')).toBeNull());

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
  it('reads an SA change', () =>
    expect(saChangeRecord(change({}))).toMatchObject({ externalId: '50003:24344970', publishedAt: '2026-01-28', title: 'SA EPA licence 50003: Authorisation Document Updated (J.J. RICHARDS & SONS PTY LTD)' }));

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
