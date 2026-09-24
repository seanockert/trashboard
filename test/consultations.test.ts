import { describe, expect, it } from 'vitest';
import { cthProjectRecord, inertiaVersion, namesPerson, waConsultationRecord } from '../src/sources/consultations';

describe('consultation dates', () => {
  it('gives the DCCEEW period in Sydney days, in words', () =>
    expect(
      cthProjectRecord({ id: 'p1', key: 'k', title: 'Proposed standards', description: '', starts: '2026-09-20T23:00:00.000Z', ends: '2026-10-23T06:00:00.000Z' }),
    ).toMatchObject({ publishedAt: '2026-09-21', body: expect.stringContaining('Consultation period: 21 September 2026 to 23 October 2026') }));

  it('reads the Citizen Space dates of WA DWER', () =>
    expect(
      waConsultationRecord({ id: 'c1', dept: 'policy', title: 'Policy', url: 'https://consult.dwer.wa.gov.au/policy/c1', overview: '', startdate: '2026/08/18', enddate: '2026/09/08', department: 'Policy' }),
    ).toMatchObject({ publishedAt: '2026-08-18', body: expect.stringContaining('Consultation period: 18 August 2026 to 8 September 2026') }));
});

describe('Engage Victoria', () => {
  it('reads the Inertia version from the home page', () =>
    expect(inertiaVersion('<div id="app" data-page="{&quot;component&quot;:&quot;Homepage&quot;,&quot;version&quot;:&quot;6666cd76f9&quot;}">')).toBe('6666cd76f9'));

  const project = (title: string) => ({ id: 1, title, summary: '', description: '', url: 'https://engage.vic.gov.au/x', created_at: '', team: null, public_stages: null });
  it.each([
    ['John Smith (APP051293)', true],
    ['Advanced Composting Technologies of Australasia PTY LTD (APP051292)', false],
    ['Draft waste strategy', false],
  ])('%s names a person: %s', (title, expected) => expect(namesPerson(project(title))).toBe(expected));
});
