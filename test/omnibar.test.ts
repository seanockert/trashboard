import { describe, expect, it } from 'vitest';
import { ftsFilter } from '../src/search';
import { inboxFields, inboxParams, parseInboxFilters, scopeOf, shownFilters } from '../src/web/models';
import { formatOmni, parseOmni } from '../src/web/omnibar';

const now = new Date('2026-09-24T00:00:00Z');
const fields = inboxFields(now);

describe('parseOmni', () => {
  it('reads tokens and free text in any order', () =>
    expect(parseOmni(fields, 'stormwater topic:levy jurisdiction:qld fines')).toEqual({
      picked: { topic: 'topicLevy', jurisdiction: 'QLD' },
      text: 'stormwater fines',
      invalid: [],
    }));
  it('uses the last token for a key', () => expect(parseOmni(fields, 'period:7d period:12m').picked).toEqual({ period: '12m' }));
  it('keeps unknown keys and values as invalid', () =>
    expect(parseOmni(fields, 'topic:nope colour:red levy')).toEqual({ picked: {}, text: 'levy', invalid: ['topic:nope', 'colour:red'] }));
  it('gives nothing for an empty string', () => expect(parseOmni(fields, '   ')).toEqual({ picked: {}, text: '', invalid: [] }));
  it('has parts of the business and topics in one field', () => expect(parseOmni(fields, 'topic:fleet').picked).toEqual({ topic: 'lobFleet' }));
  it('knows the recent quarters', () => {
    expect(parseOmni(fields, 'period:2026-q3').picked).toEqual({ period: '2026-Q3' });
    expect(parseOmni(fields, 'period:2024-Q1').invalid).toEqual(['period:2024-Q1']);
  });
});

describe('formatOmni', () => {
  it('writes tokens in field order, then invalid tokens, then text', () =>
    expect(formatOmni(fields, { picked: { company: 'jjr', period: '12m', type: 'law' }, text: 'river', invalid: ['x:y'] })).toBe('period:12m type:law company:jjr x:y river'));
  it('gives the same filters after a round trip', () => {
    const first = parseOmni(fields, 'company:any topic:fleet period:30d truck noise');
    expect(parseOmni(fields, formatOmni(fields, first))).toEqual(first);
  });
});

describe('inbox filters', () => {
  it('has no period and the New tab when the query has none', () => {
    const filters = parseInboxFilters({}, now);
    expect(filters.picked.period).toBeUndefined();
    expect(filters.tab).toBe('new');
    expect(scopeOf(filters, now, 4).period).toBeUndefined();
  });
  it('ignores a bad tab or view', () => expect(parseInboxFilters({ tab: 'x', view: 'y' }, now)).toMatchObject({ tab: 'new', view: undefined }));
  it('gives URL parameters without the defaults', () =>
    expect(inboxParams(parseInboxFilters({ q: 'jurisdiction:NSW', tab: 'acting', page: '1' }, now), fields)).toEqual({ q: 'jurisdiction:NSW', tab: 'acting', view: undefined, sort: undefined, page: undefined }));
  it('gives the scope for D1', () =>
    expect(scopeOf(parseInboxFilters({ q: 'period:2026-Q2 type:enforcement leachate' }, now), now, 4)).toMatchObject({
      period: { from: '2026-04-01', to: '2026-06-30' },
      type: 'enforcement',
      match: '"leachate"*',
    }));
  it('gives the priority band to the scope', () => expect(scopeOf(parseInboxFilters({ q: 'priority:High' }, now), now, 4)).toMatchObject({ priority: 'high' }));
  it('cuts a very long query', () => expect(parseInboxFilters({ q: 'a'.repeat(1000) }, now).text).toHaveLength(300));
  it('shows the default period on the New tab only', () => {
    expect(formatOmni(fields, shownFilters(parseInboxFilters({}, now)))).toBe('period:90d');
    expect(formatOmni(fields, shownFilters(parseInboxFilters({ tab: 'acting' }, now)))).toBe('');
    expect(formatOmni(fields, shownFilters(parseInboxFilters({ view: 'report' }, now)))).toBe('');
  });
  it('does not put the default period of the New tab in the URL', () => {
    expect(inboxParams(parseInboxFilters({ q: 'period:90d levy' }, now), fields).q).toBe('levy');
    expect(inboxParams(parseInboxFilters({ q: 'period:90d', tab: 'acting' }, now), fields).q).toBe('period:90d');
  });
  it('gives all days for the all time period', () =>
    expect(scopeOf(parseInboxFilters({ q: 'period:all' }, now), now, 4).period).toMatchObject({ from: '0000-01-01', to: '2026-09-24' }));
});

describe('ftsFilter', () => {
  it('needs each word, as a prefix', () => expect(ftsFilter('Stock-piles at "Yatala"')).toBe('"stock"* "piles"* "at"* "yatala"*'));
  it('gives an empty string for no words', () => expect(ftsFilter(' - ')).toBe(''));
});
