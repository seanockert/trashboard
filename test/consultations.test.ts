import { describe, expect, it } from 'vitest';
import { NewItem } from '../src/items';
import { dateCandidates } from '../src/jev/dates';
import { cthProjectRecord, extractNswProject, inertiaVersion, nswProjectRecord, vicProjectRecord, waConsultationRecord } from '../src/sources/consultations';

describe('NSW EPA Your Say', () => {
  const record = nswProjectRecord({
    projectID: 742,
    projectName: 'New Organics Processing Facility Guidelines',
    projectDescription: 'We are seeking your feedback on new Organics Processing Facility Guidelines',
    projectPath: 'https://yoursay.epa.nsw.gov.au/new-organics-processing-facility-guidelines',
    projectDateNum: '2026-08-20',
  });
  it('reads a project and fetches its page as the detail', () =>
    expect(record).toMatchObject({ externalId: '742', publishedAt: '2026-08-20', detailUrl: 'https://yoursay.epa.nsw.gov.au/new-organics-processing-facility-guidelines' }));
  it('gives valid items', () => expect(NewItem.safeParse(record).success).toBe(true));

  it('keeps the main part of the project page, with the close date', () => {
    const text = extractNswProject('<nav>Menu</nav><main><h2>Have your say</h2><p>Consultation is now open until 5pm Friday 2 October 2026.</p></main><footer>x</footer>');
    expect(text).toBe('Have your say\nConsultation is now open until 5pm Friday 2 October 2026.');
    expect(dateCandidates(text).map((c) => c.date)).toEqual(['2026-10-02']);
  });
});

describe('Engage Victoria', () => {
  const record = vicProjectRecord({
    id: 2026,
    title: 'Advanced Composting Technologies of Australasia PTY LTD (APP051292)',
    summary: 'EPA has received a development licence application.',
    description: '<h2>Overview</h2><p>Applicant: Advanced Composting Technologies</p>',
    url: 'https://engage.vic.gov.au/advanced-composting-technologies-of-australasia-pty-ltd-app051292',
    created_at: '2026-08-26T22:45:19.000000Z',
    team: { name: 'Environment Protection Authority' },
    public_stages: [
      { title: 'Submission period', date_start: '4 September 2026', date_end: '28 September 2026' },
      { title: 'Decision', date_start: 'Late 2026', date_end: '' },
    ],
  });

  it('puts the stages with their dates before the description', () =>
    expect(record.body).toBe(
      'Consultation by Environment Protection Authority.\nSubmission period: 4 September 2026 to 28 September 2026\nDecision: Late 2026\nEPA has received a development licence application.\nOverview\nApplicant: Advanced Composting Technologies',
    ));
  it('takes the created date as the item date', () => expect(record.publishedAt).toBe('2026-08-26'));
  it('gives valid items', () => expect(NewItem.safeParse(record).success).toBe(true));
  it('reads the Inertia version from the home page', () =>
    expect(inertiaVersion('<div id="app" data-page="{&quot;component&quot;:&quot;Homepage&quot;,&quot;version&quot;:&quot;6666cd76f9&quot;}">')).toBe('6666cd76f9'));
  it('gives null when the home page has no version', () => expect(inertiaVersion('<html></html>')).toBeNull());
});

describe('DCCEEW', () => {
  const record = cthProjectRecord({
    id: 'prj24edc1c28ff933a268e8f',
    key: 'ichems-s17-proposed-decisions',
    title: 'Proposed standards for management of industrial chemicals under IChEMS',
    description: 'We are seeking feedback.',
    starts: '2026-09-20T23:00:00.000Z',
    ends: '2026-10-23T06:00:00.000Z',
  });
  it('gives the period in Sydney days, in words', () => expect(record.body).toContain('Consultation period: 21 September 2026 to 23 October 2026'));
  it('takes the Sydney start day as the item date', () => expect(record.publishedAt).toBe('2026-09-21'));
  it('finds the close date in the body', () => expect(dateCandidates(record.body).map((c) => c.date)).toEqual(['2026-09-21', '2026-10-23']));
  it('gives valid items', () => expect(NewItem.safeParse(record).success).toBe(true));
});

describe('WA DWER', () => {
  const record = waConsultationRecord({
    id: 'cockburn-sound-state-environmental-policy',
    dept: 'strategic-policy',
    title: 'Cockburn Sound State Environmental Policy',
    url: 'https://consult.dwer.wa.gov.au/strategic-policy/cockburn-sound-state-environmental-policy/consult_view',
    overview: '<p>The Department is reviewing the policy.</p>',
    startdate: '2026/08/18',
    enddate: '2026/09/08',
    department: 'Strategic Policy',
  });
  it('reads the Citizen Space dates', () => {
    expect(record.publishedAt).toBe('2026-08-18');
    expect(record.body).toContain('Consultation period: 18 August 2026 to 8 September 2026');
  });
  it('gives valid items', () => expect(NewItem.safeParse(record).success).toBe(true));
});
