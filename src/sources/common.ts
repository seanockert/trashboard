import { okAsync, errAsync, Result, type ResultAsync } from 'neverthrow';
import { z } from 'zod';
import { daysBefore, newestOf } from './dates';
import type { FetchOutcome, SourceContext, SourceError } from './types';

export const FIRST_RUN_DAYS = 365;

export const text = z.string().nullish().transform((value) => (value ?? '').trim());

export const parseError = (url: string, message: string) => errAsync<FetchOutcome, SourceError>({ type: 'parse', url, message: message.slice(0, 500) });

export const tryParse = <T>(url: string, parse: () => T): Result<T, SourceError> =>
  Result.fromThrowable(parse, (cause): SourceError => ({ type: 'parse', url, message: String(cause).slice(0, 500) }))();

export const changed = ({ records, cursor = null, next = null }: { records: unknown[]; cursor?: string | null; next?: unknown }) =>
  okAsync<FetchOutcome, SourceError>({ type: 'changed', records, cursor, next });

export const unchanged = () => okAsync<FetchOutcome, SourceError>({ type: 'unchanged' });

type Run = (ctx: SourceContext) => ResultAsync<FetchOutcome, SourceError>;

export const paged =
  <T extends z.ZodType>({ url, state, first, next }: { url: string; state: T; first: Run; next: (state: z.infer<T>, ctx: SourceContext) => ResultAsync<FetchOutcome, SourceError> }): Run =>
  (ctx) => {
    if (ctx.page === null) return first(ctx);
    const parsed = state.safeParse(ctx.page);
    return parsed.success ? next(parsed.data, ctx) : parseError(url, 'The page state is not valid.');
  };

export const lines = (pairs: [string, string][]) =>
  pairs
    .filter(([, value]) => value !== '')
    .map(([name, value]) => `${name}: ${value}`)
    .join('\n');

export const uniqueBy = <T>(list: T[], key: (item: T) => string) => {
  const seen = new Set<string>();
  return list.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

export const dollarAmounts = (text: string) =>
  [...text.matchAll(/\$\s?([\d,]+(?:\.\d{2})?)/g)].map((m) => ({ amount: Number((m[1] ?? '').replace(/,/g, '')), index: m.index, length: m[0].length }));

// Register can add older-dated records: reread `rereadDays` before cursor. Keep undated records.
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
