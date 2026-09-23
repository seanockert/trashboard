import { describe, expect, it } from 'vitest';
import { findPartyGroup, isCompanyName } from '../src/parties';

describe('isCompanyName', () => {
  it.each([
    'J.J. RICHARDS & SONS PTY LTD',
    'Cleanaway Solid Waste Pty Ltd',
    'Suez Recycling & Recovery Pty Ltd',
    'Mindarie Regional Council',
    'Cleanaway Pty Ltd (ACN: 000 164 938)',
    'SIMS GROUP AUSTRALIA HOLDINGS LIMITED',
    'Visy Glass Operations (Australia) Pty Ltd',
    'Smith & Jones Pty Ltd',
    'Acquista Investments Pty Ltd & Veolia Environmental Services (Australia) Pty Ltd',
    'FULLER & GORDON METAL RECYCLING PTY LTD',
    'Clare & Gilbert Valley Council',
    'RAZOR DEMOLITION & ASBESTOS REMOVAL PTY LTD',
    'R W & G JOHNSTON PTY LTD',
    'MJ, SE & AM Christoffel Pty. Ltd.',
  ])('keeps %s', (name) => expect(isCompanyName(name)).toBe(true));

  it.each([
    'John Smith',
    'SMITH, John',
    'John Smith Plumbing Services',
    'Spent Conviction Name Withheld',
    'Example Pty Ltd and John Smith',
    'Example Pty Ltd; John Smith',
    'John Smith (Director, Example Demolition Pty Ltd)',
    'Example Pty Ltd, director John Smith',
    'Maurice (Maurizio) Corsaro & Port Adelaide Salvage SA Pty Ltd (PAS)',
    'John Smith & Example Waste Services Pty Ltd',
    'Karl Investments Pty Ltd & Karl Stephen Chehade',
    'Ross Kingsley Woodhouse & Peninsula Downs Pty Ltd',
  ])('drops %s', (name) => expect(isCompanyName(name)).toBe(false));
});

describe('findPartyGroup', () => {
  it.each([
    ['J.J. RICHARDS & SONS PTY LTD', 'jjr'],
    ['JJ Richards North End Pty Ltd', 'jjr'],
    ['Transpacific Cleanaway Pty Ltd', 'cleanaway'],
    ['Veolia Environmental Services (Australia) Pty Ltd', 'veolia'],
    ['Brambles Australia Ltd t/a Cleanaway, Wingfield', 'cleanaway'],
    ['Richards Road Pty Ltd', null],
    ['Bingo Nominees Pty Ltd', null],
  ])('%s -> %s', (name, group) => expect(findPartyGroup(name)).toBe(group));
});
