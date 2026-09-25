import type { ResultAsync } from 'neverthrow';
import type { NewItem } from '../items';

export type SourceError =
  | { type: 'http'; url: string; status: number }
  | { type: 'network'; url: string; cause: unknown }
  | { type: 'parse'; url: string; message: string };

export type FetchOutcome =
  | { type: 'unchanged' }
  | {
      type: 'changed';
      records: unknown[];
      // Stopped run restarts from old cursor.
      cursor: string | null;
      // Free plan: 10 ms CPU, 50 subrequests per invocation.
      next: unknown;
    };

export type SourceContext = { cursor: string | null; now: Date; page: unknown; since: string | null };

export type Source = {
  id: string;
  name: string;
  kind: NewItem['kind'];
  homepage: string;
  run: (ctx: SourceContext) => ResultAsync<FetchOutcome, SourceError>;
  extractDetail?: (html: string) => string;
  prose?: true;
  manualOnly?: boolean;
};
