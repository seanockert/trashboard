import { describe, expect, it } from 'vitest';
import { dollarTotal, latestDate } from '../src/sources/dates';
import { penaltyCandidates, selectedPenalty } from '../src/jev/penalty';
import { dateCandidates, selectedDate } from '../src/jev/dates';

describe('latestDate', () => {
  it('reads two-digit years and takes the latest date', () => {
    expect(latestDate('Convicted 17/6/25 Sentence imposed on 22/08/25')).toBe('2025-08-22');
  });
  it('reads month names', () => expect(latestDate('12 September 2025 In the ERD Court')).toBe('2025-09-12'));
  it('ignores dates that do not exist', () => expect(latestDate('31/02/2024')).toBeNull());
});

describe('dollarTotal', () => {
  it('adds the amounts in a cell', () => expect(dollarTotal('$3750 $11,250')).toBe(15000));
  it('gives null when there is no amount', () => expect(dollarTotal('N/A')).toBeNull());
});

describe('penalty selection', () => {
  const text = 'The court ordered a fine of $60,000. The estimated clean-up spend is $953,000.';
  const candidates = penaltyCandidates(text);

  it('finds each amount with its context', () => {
    expect(candidates.map((c) => c.amount)).toEqual([60000, 953000]);
    expect(candidates[0]?.excerpt).toContain('fine of $60,000');
  });
  it('uses only an amount from the text', () => {
    expect(selectedPenalty({ candidates, answer: { choice: 'amount_1', confidence: 0.9 } })).toBe(60000);
    expect(selectedPenalty({ candidates, answer: { choice: 'none', confidence: 0.9 } })).toBeNull();
  });
  it('ignores an uncertain selection', () => {
    expect(selectedPenalty({ candidates, answer: { choice: 'amount_1', confidence: 0.3 } })).toBeNull();
  });
});

describe('date selection', () => {
  const text = 'Published 3 June 2026. Submissions close on 2 July 2026. The rules start on 1/7/2027. Submissions close on 2 July 2026.';
  const candidates = dateCandidates(text);

  it('finds each date one time, with its context', () => {
    expect(candidates.map((c) => c.date)).toEqual(['2027-07-01', '2026-06-03', '2026-07-02']);
    expect(candidates.find((c) => c.date === '2026-07-02')?.excerpt).toContain('Submissions close on 2 July 2026');
  });
  it('uses only a date from the text', () => {
    expect(selectedDate({ candidates, answer: { choice: 'date_3', confidence: 0.9 } })).toBe('2026-07-02');
    expect(selectedDate({ candidates, answer: { choice: 'none', confidence: 0.9 } })).toBeNull();
  });
  it('ignores an uncertain selection', () => expect(selectedDate({ candidates, answer: { choice: 'date_1', confidence: 0.4 } })).toBeNull());
  it('gives no candidates when the text has no dates', () => expect(dateCandidates('No dates here.')).toEqual([]));

  it('takes the year of a date with no year from the publication date', () => {
    const found = dateCandidates('A conference will be held on 9 May. Submissions close 3 January.', '2026-04-20');
    expect(found.map((c) => c.date)).toEqual(['2026-05-09', '2027-01-03']);
  });
  it('keeps a date with no year that is a few days before publication in the same year', () =>
    expect(dateCandidates('On 15 April the EPA issued a notice.', '2026-04-20').map((c) => c.date)).toEqual(['2026-04-15']));
  it('ignores a date with no year when the publication date is not known', () => expect(dateCandidates('Held on 9 May.')).toEqual([]));
  it('does not read a date with a year two times', () => expect(dateCandidates('Closes 2 July 2026.', '2026-04-20').map((c) => c.date)).toEqual(['2026-07-02']));
});
