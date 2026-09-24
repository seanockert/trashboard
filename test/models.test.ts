import { describe, expect, it } from 'vitest';
import type { StoredItem } from '../src/items';
import { bandStats, dateEntries, penaltyBenchmarks, quarterRange, recentQuarters, type ChangeRow } from '../src/web/models';

describe('penaltyBenchmarks', () => {
  const rows = [
    { offence: 'water', penalty: 30000 },
    { offence: 'water', penalty: 10000 },
    { offence: 'water', penalty: 20000 },
    { offence: 'water', penalty: 90000 },
    { offence: 'noise', penalty: 5000 },
    { offence: null, penalty: 1000 },
  ];
  it('gives the count, the median and the highest amount for each conduct', () =>
    expect(penaltyBenchmarks(rows)).toEqual([
      { id: 'water', label: 'Water pollution', count: 4, median: 25000, highest: 90000 },
      { id: 'noise', label: 'Noise', count: 1, median: 5000, highest: 5000 },
      { id: 'unknown', label: 'Not stated', count: 1, median: 1000, highest: 1000 },
    ]));
});

describe('dateEntries', () => {
  const row = (id: string, closesOn: string | null, startsOn: string | null, priority: number) =>
    ({ item: { id, closesOn, startsOn } as StoredItem, priority }) as ChangeRow;
  const rows = [row('a', '2026-10-01', '2027-07-01', 0.3), row('b', null, '2026-10-01', 0.6), row('c', '2026-09-01', null, 0.9)];
  it('gives one entry for each date in the range, soonest first, then by priority', () =>
    expect(dateEntries({ rows, from: '2026-09-24', to: '2026-12-31' }).map((e) => `${e.date} ${e.type} ${e.row.item.id}`)).toEqual([
      '2026-10-01 starts b',
      '2026-10-01 closes a',
    ]));
});

describe('quarters', () => {
  it('gives the first and last day', () => expect(quarterRange('2026-Q3')).toEqual({ from: '2026-07-01', to: '2026-09-30', label: 'July to September 2026' }));
  it('handles a leap year', () => expect(quarterRange('2028-Q1').to).toBe('2028-03-31'));
  it('lists recent quarters across a year end', () => expect(recentQuarters(new Date('2026-02-10'), 3)).toEqual(['2026-Q1', '2025-Q4', '2025-Q3']));
});

describe('bandStats', () => {
  it('adds the types in each band and keeps empty bands', () => {
    const stats = bandStats([
      { band: 'high', type: 'law', n: 4, useful: 4 },
      { band: 'high', type: 'enforcement', n: 6, useful: 2 },
    ]);
    expect(stats[0]).toMatchObject({ band: 'high', count: 10, useful: 6 });
    expect(stats[0]?.types[0]?.type).toBe('enforcement');
    expect(stats.map((s) => s.count)).toEqual([10, 0, 0, 0]);
  });
});
