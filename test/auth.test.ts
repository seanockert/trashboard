import { describe, expect, it } from 'vitest';
import { safeNext } from '../src/web/auth';

describe('safeNext', () => {
  it.each([
    ['/?q=topic:levy', '/?q=topic:levy'],
    ['//evil.com', '/'],
    ['/\\evil.com', '/'],
    ['https://evil.com', '/'],
    [undefined, '/'],
  ])('%s -> %s', (next, expected) => expect(safeNext(next)).toBe(expected));
});
