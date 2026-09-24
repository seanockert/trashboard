import { describe, expect, it } from 'vitest';
import { firstDate, latestDate } from '../src/sources/dates';
import { decodeEntities } from '../src/sources/html';
import { penaltyCandidates, selectedPenalty } from '../src/jev/penalty';
import { dateCandidates, selectedDate } from '../src/jev/dates';

describe('dates in text', () => {
  it('reads two-digit years and takes the latest date', () => expect(latestDate('Convicted 17/6/25 Sentence imposed on 22/08/25')).toBe('2025-08-22'));
  it('ignores dates that do not exist', () => expect(latestDate('31/02/2024')).toBeNull());
  it('takes the first date in the order of the text', () => expect(firstDate('12 September 2025 In the ERD Court, for an offence on 3/4/2023.')).toBe('2025-09-12'));
  it('gives a date with no year the year after publication when it is earlier', () =>
    expect(dateCandidates('Held on 9 May. Submissions close 3 January. On 15 April a notice.', '2026-04-20').map((c) => c.date)).toEqual(['2026-05-09', '2027-01-03', '2026-04-15']));
});

describe('Jev selections', () => {
  it('uses only a penalty from the text, and only when Jev is sure', () => {
    const candidates = penaltyCandidates('The court ordered a fine of $60,000. The estimated clean-up spend is $953,000.');
    expect(selectedPenalty({ candidates, answer: { choice: 'amount_1', confidence: 0.9 } })).toBe(60000);
    expect(selectedPenalty({ candidates, answer: { choice: 'amount_1', confidence: 0.3 } })).toBeNull();
    expect(selectedPenalty({ candidates, answer: { choice: 'none', confidence: 0.9 } })).toBeNull();
  });
  it('gives each date one candidate, and uses only a date from the text', () => {
    const candidates = dateCandidates('Submissions close on 2 July 2026. The rules start on 1/7/2027. Submissions close on 2 July 2026.');
    expect(candidates.map((c) => c.date)).toEqual(['2027-07-01', '2026-07-02']);
    expect(selectedDate({ candidates, answer: { choice: 'date_2', confidence: 0.9 } })).toBe('2026-07-02');
    expect(selectedDate({ candidates, answer: { choice: 'date_2', confidence: 0.4 } })).toBeNull();
  });
});

describe('decodeEntities', () => {
  it('keeps an entity that is not a valid code point', () => expect(decodeEntities('A &#99999999; B &amp; C')).toBe('A &#99999999; B & C'));
});
