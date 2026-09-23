import { describe, expect, it } from 'vitest';
import { dollarTotal, latestDate } from '../src/sources/dates';
import { penaltyCandidates, selectedPenalty } from '../src/jev/penalty';

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
