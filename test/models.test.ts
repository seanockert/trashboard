import { describe, expect, it } from 'vitest';
import type { StoredItem } from '../src/items';
import { dateEntries, penaltyBenchmarks, periodRange, quarterOf, recentQuarters, type Row } from '../src/web/models';

describe('penaltyBenchmarks', () => {
  it('gives the median and the highest amount for each conduct', () =>
    expect(penaltyBenchmarks([30000, 10000, 20000, 90000].map((penalty) => ({ offence: 'water', penalty })))).toMatchObject([{ id: 'water', count: 4, median: 25000, highest: 90000 }]));
});

describe('dateEntries', () => {
  const row = (id: string, closesOn: string | null, startsOn: string | null, priority: number) => ({ item: { id, closesOn, startsOn } as StoredItem, priority }) as Row;
  const rows = [row('a', '2026-10-01', '2027-07-01', 0.3), row('b', null, '2026-10-01', 0.6), row('c', '2026-09-01', null, 0.9)];
  it('gives one entry for each date in the range, soonest first, then by priority', () =>
    expect(dateEntries({ rows, from: '2026-09-24', to: '2026-12-31' }).map((e) => `${e.date} ${e.type} ${e.row.item.id}`)).toEqual(['2026-10-01 starts b', '2026-10-01 closes a']));
});

describe('quarters', () => {
  it('lists recent quarters across a year end', () => expect(recentQuarters(new Date('2026-02-10'), 3)).toEqual(['2026-Q1', '2025-Q4', '2025-Q3']));
  it('uses the Brisbane day at a quarter start', () => {
    // 1 July 01:00 Brisbane = 30 June UTC.
    expect(quarterOf(new Date('2026-06-30T15:00:00Z'))).toBe('2026-Q3');
    expect(recentQuarters(new Date('2025-12-31T15:00:00Z'), 1)).toEqual(['2026-Q1']);
  });
});

describe('periodRange', () => {
  const now = new Date('2026-09-24T00:00:00Z');
  it('counts back from today for a recent period', () => expect(periodRange('30d', now)).toEqual({ from: '2026-08-25', to: '2026-09-24', label: 'Last 30 days' }));
  it('gives the days of a quarter', () => expect(periodRange('2026-Q2', now)).toEqual({ from: '2026-04-01', to: '2026-06-30', label: 'April to June 2026' }));
});
