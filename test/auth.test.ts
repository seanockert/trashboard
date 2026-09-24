import { describe, expect, it } from 'vitest';
import { safeNext } from '../src/web/auth';

describe('safeNext', () => {
  it.each([
    ['/changes?topic=topicLevy', '/changes?topic=topicLevy'],
    ['//evil.com', '/changes'],
    ['/\\evil.com', '/changes'],
    ['https://evil.com', '/changes'],
    [undefined, '/changes'],
  ])('%s -> %s', (next, expected) => expect(safeNext(next)).toBe(expected));
});
