import type { ResultAsync } from 'neverthrow';
import type { Jurisdiction, NewItem } from '../items';

export type SourceError =
  | { type: 'http'; url: string; status: number }
  | { type: 'network'; url: string; cause: unknown }
  | { type: 'parse'; url: string; message: string };

export type FetchOutcome =
  | { type: 'unchanged' }
  | {
      type: 'changed';
      // Raw records. The pipeline checks each one against `NewItem`.
      records: unknown[];
      // Saved after the last page only. A run that stops halfway starts again from the old cursor.
      cursor: string | null;
      // The next page, as JSON. The pipeline sends it in a new queue message, because
      // each invocation on the Workers Free plan has 10 ms of CPU and 50 subrequests.
      next: unknown;
    };

// `page` is null for the first page, else the `next` value of the page before it.
// `since` is an ISO date for a backfill run, else null. A source that supports a backfill uses it in place of the cursor.
export type SourceContext = { cursor: string | null; now: Date; page: unknown; since: string | null };

export type Source = {
  id: string;
  name: string;
  kind: NewItem['kind'];
  jurisdiction: Jurisdiction;
  homepage: string;
  run: (ctx: SourceContext) => ResultAsync<FetchOutcome, SourceError>;
  // Turns the page at an item's `detailUrl` into the item body.
  extractDetail?: (html: string) => string;
  // The worker cannot fetch this source. The daily run skips it, and a script on a local computer sends the pages.
  manualOnly?: boolean;
};
