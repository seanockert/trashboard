import { describe, expect, it } from 'vitest';
import { ftsFilter } from '../src/search';
import { CHANGES_FIELDS, changesFlags, changesParams, ENFORCEMENT_FIELDS, parseChangesFilters, parseEnforcementFilters } from '../src/web/models';
import { formatOmni, parseOmni } from '../src/web/omnibar';

describe('parseOmni', () => {
  it('reads tokens and free text in any order', () =>
    expect(parseOmni(CHANGES_FIELDS, 'stormwater topic:levy jurisdiction:qld fines')).toEqual({
      picked: { topic: 'topicLevy', jurisdiction: 'QLD' },
      text: 'stormwater fines',
      invalid: [],
    }));
  it('uses the last token for a key', () => expect(parseOmni(CHANGES_FIELDS, 'period:7d period:12m').picked).toEqual({ days: 365 }));
  it('keeps unknown keys and values as invalid', () =>
    expect(parseOmni(CHANGES_FIELDS, 'topic:nope colour:red levy')).toEqual({ picked: {}, text: 'levy', invalid: ['topic:nope', 'colour:red'] }));
  it('gives nothing for an empty string', () => expect(parseOmni(CHANGES_FIELDS, '   ')).toEqual({ picked: {}, text: '', invalid: [] }));
});

describe('formatOmni', () => {
  it('writes tokens in field order, then invalid tokens, then text', () =>
    expect(formatOmni(ENFORCEMENT_FIELDS, { picked: { offence: 'water', days: 730, group: 'jjr' }, text: 'river', invalid: ['x:y'] })).toBe('period:2y company:jjr conduct:water x:y river'));
  it('gives the same filters after a round trip', () => {
    const first = parseOmni(CHANGES_FIELDS, 'company:any part:fleet period:30d truck noise');
    expect(parseOmni(CHANGES_FIELDS, formatOmni(CHANGES_FIELDS, first))).toEqual(first);
  });
});

describe('page filters', () => {
  it('uses the default period when the query has none', () => {
    expect(parseChangesFilters({}).picked.days).toBe(90);
    expect(parseEnforcementFilters({ q: 'conduct:air' }).picked).toEqual({ offence: 'air', days: 1825 });
  });
  it('makes flags from the tokens and the checkboxes', () =>
    expect(changesFlags(parseChangesFilters({ q: 'part:fleet topic:safety', action: '1', submissions: '1' }))).toEqual(['lobFleet', 'topicSafety', 'actionRequired', 'submissionsOpen']));
  it('gives URL parameters with the period and without page 1', () =>
    expect(changesParams(parseChangesFilters({ q: 'jurisdiction:NSW', page: '1' }))).toEqual({ q: 'period:90d jurisdiction:NSW', action: undefined, submissions: undefined, all: undefined, page: undefined }));
  it('cuts a very long query', () => expect(parseChangesFilters({ q: 'a'.repeat(1000) }).text).toHaveLength(300));
});

describe('ftsFilter', () => {
  it('needs each word, as a prefix', () => expect(ftsFilter('Stock-piles at "Yatala"')).toBe('"stock"* "piles"* "at"* "yatala"*'));
  it('gives an empty string for no words', () => expect(ftsFilter(' - ')).toBe(''));
});
