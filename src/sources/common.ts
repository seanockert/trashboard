import { okAsync, errAsync, Result } from 'neverthrow';
import { z } from 'zod';
import { daysBefore, newestOf } from './dates';
import type { FetchOutcome, SourceError } from './types';

// A text field that can be missing or null. It becomes a trimmed string.
export const text = z.string().nullish().transform((value) => (value ?? '').trim());

// A long schema message fills the run log, thus it is cut.
export const parseError = (url: string, message: string) => errAsync<FetchOutcome, SourceError>({ type: 'parse', url, message: message.slice(0, 500) });

export const badPageState = (url: string) => parseError(url, 'The page state is not valid.');

// A parse that can throw, for example of an HTML page.
export const tryParse = <T>(url: string, parse: () => T): Result<T, SourceError> =>
  Result.fromThrowable(parse, (cause): SourceError => ({ type: 'parse', url, message: String(cause).slice(0, 500) }))();

export const changed = ({ records, cursor = null, next = null }: { records: unknown[]; cursor?: string | null; next?: unknown }) =>
  okAsync<FetchOutcome, SourceError>({ type: 'changed', records, cursor, next });

export const unchanged = () => okAsync<FetchOutcome, SourceError>({ type: 'unchanged' });

// "Name: value" lines. A line with an empty value is left out.
export const lines = (pairs: [string, string][]) =>
  pairs
    .filter(([, value]) => value !== '')
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n');

// The first item for each key, in list order.
export const uniqueBy = <T>(list: T[], key: (item: T) => string) => list.filter((item, i) => list.findIndex((other) => key(other) === key(item)) === i);

// One page of a register that lists the newest records first. The register
// can add a record with an older date, thus a run reads back to `rereadDays`
// before the cursor. The upsert ignores the records that did not change. A
// record with no date stays, because code cannot place it.
export const newestFirstPage = <R>({
  rows,
  dateOf,
  cursor,
  newestSoFar,
  rereadDays,
}: {
  rows: R[];
  dateOf: (row: R) => string | null;
  cursor: string | null;
  newestSoFar: string | null;
  rereadDays: number;
}) => {
  const since = cursor === null ? null : daysBefore(cursor, rereadDays);
  const isOld = (row: R) => {
    const date = dateOf(row);
    return since !== null && date !== null && date < since;
  };
  const fresh = rows.filter((row) => !isOld(row));
  return { fresh, newest: newestOf([cursor, newestSoFar, ...fresh.map(dateOf)]), reachedKnown: rows.some(isOld) };
};
