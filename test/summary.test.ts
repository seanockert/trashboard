import { describe, expect, it } from 'vitest';
import { clean, modelText } from '../src/summary';

const item = { title: 'Waste Levy Amendment Regulation 2026', body: 'The levy rises to $180 a tonne from 1 July 2026. Operators must submit a plan within eight weeks.' };

describe('clean', () => {
  it('removes the title from the start of "what"', () =>
    expect(clean({ answer: { what: 'Waste Levy Amendment Regulation 2026: raises the levy.', points: [] }, item }).what).toBe('raises the levy.'));
  it('keeps a point whose numbers are in the text', () =>
    expect(clean({ answer: { what: 'Raises the levy.', points: ['$180 a tonne from 1 July 2026.'] }, item }).points).toEqual(['$180 a tonne from 1 July 2026.']));
  it('drops a point with a number that is not in the text', () =>
    expect(clean({ answer: { what: 'Raises the levy.', points: ['Starts 1 July 2027.'] }, item }).points).toEqual([]));
  it('accepts a digit for a number word in the text', () =>
    expect(clean({ answer: { what: 'Raises the levy.', points: ['Plan due within 8 weeks.'] }, item }).points).toEqual(['Plan due within 8 weeks.']));
  it('drops a point copied from the prompt example', () =>
    expect(clean({ answer: { what: 'Raises the levy.', points: ['Must remove excess tyres within 90 days.'] }, item: { ...item, body: `${item.body} 90` } }).points).toEqual([]));
  it('drops a point that repeats "what" or holds the title', () =>
    expect(clean({ answer: { what: 'Raises the levy.', points: ['Raises the levy.', 'Cited as Waste Levy Amendment Regulation 2026.'] }, item }).points).toEqual([]));
  it('removes filler and duplicates', () =>
    expect(clean({ answer: { what: 'Raises the levy.', points: ['Operators must submit a plan by unspecified date.', 'Operators must submit a plan.'] }, item }).points).toEqual(['Operators must submit a plan.']));
});

describe('modelText', () => {
  it('removes the page update date at the end', () => expect(modelText('Stickers must be compostable.\nUpdated 12 March 2026')).toBe('Stickers must be compostable.'));
});
