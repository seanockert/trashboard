import { z } from 'zod';
import { Jurisdiction, TrackStatus, type NewItem, type StoredItem, type Tracking } from './items';
import { groupOf, PARTIES_VERSION } from './parties';
import { flagSql, IS_RELEVANT_SQL, IS_SERIOUS_SQL, IS_WASTE_OPERATOR_SQL, OFFENCE_SQL, PRIORITY_BAND_SQL, PRIORITY_HIGH, PRIORITY_SQL, type FlagKey } from './rank';
import { NEEDS_SUMMARY_SQL, Summary } from './summary';

const sha256 = async (text: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

export const itemId = ({ sourceId, externalId }: { sourceId: string; externalId: string }) => `${sourceId}:${externalId}`;

const enforcementFields = (item: NewItem) =>
  item.kind === 'enforcement'
    ? { party: item.party, action: item.action, location: item.location, penaltyAud: item.penaltyAud, wasteActivity: item.wasteActivity }
    : { party: null, action: null, location: null, penaltyAud: null, wasteActivity: false };

// Inserts new items and updates changed ones. A changed item loses its tags,
// its summary and the values that Jev selected, thus the next steps read the new text. Returns the IDs that need tags.
export const upsertItems =
  (db: D1Database) =>
  async ({ sourceId, items, now }: { sourceId: string; items: NewItem[]; now: Date }): Promise<string[]> => {
    const rows = await Promise.all(
      items.map(async (item) => ({ item, id: itemId({ sourceId, externalId: item.externalId }), hash: await sha256(JSON.stringify(item)) })),
    );
    const statements = rows.map(({ item, id, hash }) => {
      const extra = enforcementFields(item);
      return db
        .prepare(
          `INSERT INTO items (id, source_id, kind, jurisdiction, title, url, published_at, body, party, party_group, action, location, penalty_source_aud, content_hash, first_seen_at, detail_url, waste_activity, group_version)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
           ON CONFLICT (id) DO UPDATE SET
             title = excluded.title, url = excluded.url, published_at = excluded.published_at, body = excluded.body,
             detail_url = excluded.detail_url, detail_fetched_at = NULL,
             party = excluded.party, party_group = excluded.party_group, group_version = excluded.group_version, action = excluded.action, location = excluded.location,
             penalty_source_aud = excluded.penalty_source_aud, penalty_selected_aud = NULL, waste_activity = excluded.waste_activity, content_hash = excluded.content_hash,
             tag_version = NULL, tagged_at = NULL, answers = NULL, closes_on = NULL, starts_on = NULL, summary = NULL, summary_version = NULL
           WHERE items.content_hash != excluded.content_hash
           RETURNING id`,
        )
        .bind(
          id,
          sourceId,
          item.kind,
          item.jurisdiction,
          item.title,
          item.url,
          item.publishedAt,
          item.body,
          extra.party,
          groupOf({ kind: item.kind, party: extra.party, title: item.title, body: item.body }),
          extra.action,
          extra.location,
          extra.penaltyAud,
          hash,
          now.toISOString(),
          item.detailUrl,
          extra.wasteActivity ? 1 : 0,
          PARTIES_VERSION,
        );
    });
    // D1 limits the statements in one batch, thus send them in groups.
    const groups = Array.from({ length: Math.ceil(statements.length / 50) }, (_, i) => statements.slice(i * 50, i * 50 + 50));
    const results = await groups.reduce<Promise<D1Result[]>>(
      async (done, group) => [...(await done), ...(await db.batch(group))],
      Promise.resolve([]),
    );
    return results.flatMap((result) => z.array(z.object({ id: z.string() })).parse(result.results).map((row) => row.id));
  };

const ItemRow = z.object({
  id: z.string(),
  source_id: z.string(),
  kind: z.enum(['regulatory', 'enforcement']),
  jurisdiction: Jurisdiction,
  title: z.string(),
  url: z.string(),
  published_at: z.string().nullable(),
  body: z.string(),
  detail_url: z.string().nullable(),
  detail_fetched_at: z.string().nullable(),
  party: z.string().nullable(),
  party_group: z.string().nullable(),
  action: z.string().nullable(),
  location: z.string().nullable(),
  penalty_aud: z.number().nullable(),
  penalty_source_aud: z.number().nullable(),
  content_hash: z.string(),
  waste_activity: z.number(),
  answers: z.string().nullable(),
  summary: z.string().nullable(),
  closes_on: z.string().nullable(),
  starts_on: z.string().nullable(),
});

const toStoredItem = (row: z.infer<typeof ItemRow>): StoredItem => ({
  id: row.id,
  sourceId: row.source_id,
  kind: row.kind,
  jurisdiction: row.jurisdiction,
  title: row.title,
  url: row.url,
  publishedAt: row.published_at,
  body: row.body,
  detailUrl: row.detail_url,
  detailFetchedAt: row.detail_fetched_at,
  party: row.party,
  partyGroup: row.party_group,
  action: row.action,
  location: row.location,
  penaltyAud: row.penalty_aud,
  penaltySourceAud: row.penalty_source_aud,
  contentHash: row.content_hash,
  wasteActivity: row.waste_activity === 1,
  answers: row.answers === null ? null : JSON.parse(row.answers),
  summary: row.summary === null ? null : (Summary.safeParse(JSON.parse(row.summary)).data ?? null),
  closesOn: row.closes_on,
  startsOn: row.starts_on,
});

const ITEM_COLUMNS =
  'id, source_id, kind, jurisdiction, title, url, published_at, body, detail_url, detail_fetched_at, party, party_group, action, location, penalty_aud, penalty_source_aud, content_hash, waste_activity, answers, summary, closes_on, starts_on';

const parseRows = (result: { results: unknown[] }) => z.array(ItemRow).parse(result.results).map(toStoredItem);

// Rows that also select `PRIORITY_SQL AS priority`.
const parseRanked = (result: { results: unknown[] }) => {
  const priorities = z.array(z.object({ priority: z.number() })).parse(result.results);
  return parseRows(result).map((item, i) => ({ item, priority: priorities[i]?.priority ?? 0 }));
};

export const getItems = (db: D1Database) => async (ids: string[]) =>
  ids.length === 0
    ? []
    : parseRows(
        await db
          .prepare(`SELECT ${ITEM_COLUMNS} FROM items WHERE id IN (${ids.map((_, i) => `?${i + 1}`).join(', ')})`)
          .bind(...ids)
          .all(),
      );

// Each write of Jev output applies only to the text that Jev read. A newer
// text has a new hash and a new message on the queue.
export const saveAnswers =
  (db: D1Database) =>
  async ({
    itemId: id,
    contentHash,
    answers,
    version,
    now,
    penaltyAud,
    closesOn,
    startsOn,
  }: {
    itemId: string;
    contentHash: string;
    answers: unknown;
    version: number;
    now: Date;
    penaltyAud: number | null;
    closesOn: string | null;
    startsOn: string | null;
  }) => {
    await db
      .prepare(
        `UPDATE items SET answers = ?1, tag_version = ?2, tagged_at = ?3, penalty_selected_aud = ?5, closes_on = ?6, starts_on = ?7
         WHERE id = ?4 AND content_hash = ?8`,
      )
      .bind(JSON.stringify(answers), version, now.toISOString(), id, penaltyAud, closesOn, startsOn, contentHash)
      .run();
  };

// The detail page can name a company group that the list text does not.
export const saveDetail =
  (db: D1Database) =>
  async ({ itemId: id, contentHash, body, group, now }: { itemId: string; contentHash: string; body: string; group: string | null; now: Date }) => {
    await db
      .prepare(
        `UPDATE items SET body = ?1, detail_fetched_at = ?2, summary = NULL, summary_version = NULL, party_group = ?4, group_version = ?5
         WHERE id = ?3 AND content_hash = ?6`,
      )
      .bind(body, now.toISOString(), id, group, PARTIES_VERSION, contentHash)
      .run();
  };

// A null summary stores the attempt, thus the daily run does not ask again
// for an item that gives no usable answer. A new version asks again.
export const saveSummary =
  (db: D1Database) =>
  async ({ itemId: id, contentHash, summary, version }: { itemId: string; contentHash: string; summary: Summary | null; version: number }) => {
    await db
      .prepare('UPDATE items SET summary = ?1, summary_version = ?2 WHERE id = ?3 AND content_hash = ?4')
      .bind(summary === null ? null : JSON.stringify(summary), version, id, contentHash)
      .run();
  };

// Items with a group from an older alias list.
export const staleGroupIds = (db: D1Database) => async ({ version, limit }: { version: number; limit: number }) =>
  z
    .array(z.object({ id: z.string() }))
    .parse((await db.prepare('SELECT id FROM items WHERE group_version IS NOT ?1 LIMIT ?2').bind(version, limit).all()).results)
    .map((row) => row.id);

export const saveGroups = (db: D1Database) => async ({ groups, version }: { groups: { itemId: string; group: string | null }[]; version: number }) => {
  if (groups.length > 0) await db.batch(groups.map(({ itemId: id, group }) => db.prepare('UPDATE items SET party_group = ?1, group_version = ?2 WHERE id = ?3').bind(group, version, id)));
};

// Items that the views show by default and that have no current summary.
// `ids` limits the check to those items, for example the ones just tagged.
export const unsummarisedIds =
  (db: D1Database) =>
  async ({ tagVersion, version, limit, ids }: { tagVersion: number; version: number; limit: number; ids?: string[] }) => {
    if (ids?.length === 0) return [];
    const only = ids === undefined ? '' : ` AND id IN (${ids.map((_, i) => `?${i + 4}`).join(', ')})`;
    const result = await db
      .prepare(`SELECT id FROM items WHERE tag_version = ?1 AND (summary_version IS NULL OR summary_version < ?2) AND ${NEEDS_SUMMARY_SQL}${only} LIMIT ?3`)
      .bind(tagVersion, version, limit, ...(ids ?? []))
      .all();
    return z.array(z.object({ id: z.string() })).parse(result.results).map((row) => row.id);
  };

// `seenBefore` skips new items that a run in progress has sent to the queue already.
const UNTAGGED_SQL = '(tag_version IS NULL OR tag_version < ?1)';

export const untaggedIds = (db: D1Database) => async ({ version, limit, seenBefore }: { version: number; limit: number; seenBefore: Date }) =>
  z
    .array(z.object({ id: z.string() }))
    .parse(
      (
        await db
          .prepare(`SELECT id FROM items WHERE ${UNTAGGED_SQL} AND first_seen_at < ?3 LIMIT ?2`)
          .bind(version, limit, seenBefore.toISOString())
          .all()
      ).results,
    )
    .map((row) => row.id);

const Count = z.object({ n: z.number() });

// A condition with its own values for the "?" marks in it, in order.
type Clause = { sql: string; params: (string | number)[] };
const clause = (sql: string, ...params: (string | number)[]): Clause => ({ sql, params });
const whereOf = (clauses: Clause[]) => ({ sql: clauses.map((c) => c.sql).join(' AND '), params: clauses.flatMap((c) => c.params) });
const when = (test: boolean, make: () => Clause): Clause[] => (test ? [make()] : []);

// Items in the period whose answers match the current questions. Older
// answers do not have the same meaning, thus they wait for new tags.
const period = ({ kind, version, since }: { kind: NewItem['kind']; version: number; since: string }) =>
  clause('kind = ? AND tag_version = ? AND COALESCE(published_at, substr(first_seen_at, 1, 10)) >= ?', kind, version, since);

// Items whose title, body or party has each word. `match` is an FTS5 query, see ftsFilter.
const textMatch = (match: string | undefined) => when(match !== undefined && match !== '', () => clause('rowid IN (SELECT rowid FROM items_fts WHERE items_fts MATCH ?)', match ?? ''));

const first = (result: D1Result | undefined) => Count.array().parse(result?.results ?? [])[0]?.n ?? 0;

export type RegulatoryQuery = {
  since: string;
  version: number;
  jurisdiction: string | undefined;
  // A company group ID, or "any" for an item that names any known group.
  company: string | undefined;
  flags: FlagKey[];
  match: string | undefined;
  relevantOnly: boolean;
  limit: number;
  offset: number;
};

export const regulatoryPage = (db: D1Database) => async (q: RegulatoryQuery) => {
  const base = period({ kind: 'regulatory', version: q.version, since: q.since });
  const filters = whereOf([
    base,
    ...when(q.relevantOnly, () => clause(IS_RELEVANT_SQL)),
    ...when(q.jurisdiction !== undefined, () => clause('jurisdiction = ?', q.jurisdiction ?? '')),
    ...when(q.company === 'any', () => clause('party_group IS NOT NULL')),
    ...when(q.company !== undefined && q.company !== 'any', () => clause('party_group = ?', q.company ?? '')),
    ...q.flags.map((key) => clause(flagSql(key))),
    ...textMatch(q.match),
  ]);
  // Items that name JJ Richards come first, thus the user cannot miss them.
  const [page, matched] = await db.batch([
    db
      .prepare(`SELECT ${ITEM_COLUMNS}, ${PRIORITY_SQL} AS priority FROM items WHERE ${filters.sql} ORDER BY party_group IS 'jjr' DESC, priority DESC LIMIT ? OFFSET ?`)
      .bind(...filters.params, q.limit, q.offset),
    db.prepare(`SELECT COUNT(*) AS n FROM items WHERE ${filters.sql}`).bind(...filters.params),
  ]);
  return {
    rows: parseRanked(page ?? { results: [] }),
    matched: first(matched),
  };
};

export type EnforcementQuery = {
  since: string;
  version: number;
  jurisdiction: string | undefined;
  wasteOnly: boolean;
  group: string | undefined;
  offence: string | undefined;
  match: string | undefined;
  limit: number;
  offset: number;
};

// Enforcement counts for each company group. Records with no known group count as "other".
const groupCounts = (db: D1Database, where: { sql: string; params: unknown[] }) =>
  db
    .prepare(
      `SELECT COALESCE(party_group, 'other') AS grp, COUNT(*) AS n, SUM(penalty_aud) AS penalty, SUM(${IS_SERIOUS_SQL}) AS serious
       FROM items WHERE ${where.sql} GROUP BY grp`,
    )
    .bind(...where.params);

const GroupRow = z.object({ grp: z.string(), n: z.number(), penalty: z.number().nullable(), serious: z.number() });
const PenaltyRow = z.object({ offence: z.string().nullable(), penalty: z.number() });
const OffenceRow = z.object({ offence: z.string().nullable(), n: z.number() });

export const enforcementPage = (db: D1Database) => async (q: EnforcementQuery) => {
  // The comparison table and the conduct counts use the base filters only.
  const base = whereOf([
    period({ kind: 'enforcement', version: q.version, since: q.since }),
    ...when(q.wasteOnly, () => clause(IS_WASTE_OPERATOR_SQL)),
    ...when(q.jurisdiction !== undefined, () => clause('jurisdiction = ?', q.jurisdiction ?? '')),
  ]);
  const listed = whereOf([
    base,
    ...when(q.group !== undefined, () => clause(`COALESCE(party_group, 'other') = ?`, q.group ?? '')),
    ...when(q.offence !== undefined, () => clause(`${OFFENCE_SQL} = ?`, q.offence ?? '')),
    ...textMatch(q.match),
  ]);
  const [groups, offences, page, matched, penalties] = await db.batch([
    groupCounts(db, base),
    db.prepare(`SELECT ${OFFENCE_SQL} AS offence, COUNT(*) AS n FROM items WHERE ${base.sql} GROUP BY offence`).bind(...base.params),
    db.prepare(`SELECT ${ITEM_COLUMNS} FROM items WHERE ${listed.sql} ORDER BY published_at DESC LIMIT ? OFFSET ?`).bind(...listed.params, q.limit, q.offset),
    db.prepare(`SELECT COUNT(*) AS n FROM items WHERE ${listed.sql}`).bind(...listed.params),
    // Two small columns for each record with a known penalty. The Worker finds the median.
    db.prepare(`SELECT ${OFFENCE_SQL} AS offence, penalty_aud AS penalty FROM items WHERE ${base.sql} AND penalty_aud IS NOT NULL`).bind(...base.params),
  ]);
  return {
    groups: GroupRow.array().parse(groups?.results ?? []),
    offences: OffenceRow.array().parse(offences?.results ?? []),
    penalties: PenaltyRow.array().parse(penalties?.results ?? []),
    rows: parseRows(page ?? { results: [] }),
    matched: first(matched),
  };
};

const prefixed = ITEM_COLUMNS.split(', ').map((c) => `items.${c}`).join(', ');

const TrackingRow = z.object({ item_id: z.string(), status: TrackStatus, note: z.string() });

// The tracking of the items on one page.
export const trackingFor = (db: D1Database) => async (ids: string[]): Promise<Map<string, Tracking>> => {
  if (ids.length === 0) return new Map();
  const result = await db
    .prepare(`SELECT item_id, status, note FROM tracked WHERE item_id IN (${ids.map((_, i) => `?${i + 1}`).join(', ')})`)
    .bind(...ids)
    .all();
  return new Map(z.array(TrackingRow).parse(result.results).map((row) => [row.item_id, { status: row.status, note: row.note }]));
};

// All tracked items. "Acting" first, then the most recent change.
export const trackedItems = (db: D1Database) => async () => {
  const result = await db
    .prepare(`SELECT ${prefixed}, tracked.status, tracked.note FROM tracked JOIN items ON items.id = tracked.item_id ORDER BY tracked.status = 'acting' DESC, tracked.updated_at DESC`)
    .all();
  const tracking = z.array(z.object({ status: TrackStatus, note: z.string() })).parse(result.results);
  return parseRows(result).flatMap((item, i) => {
    const t = tracking[i];
    return t === undefined ? [] : [{ item, tracking: { status: t.status, note: t.note } }];
  });
};

// A null status stops the tracking of the item.
export const saveTracking =
  (db: D1Database) =>
  async ({ itemId: id, status, note, now }: { itemId: string; status: TrackStatus | null; note: string; now: Date }) => {
    if (status === null) {
      await db.prepare('DELETE FROM tracked WHERE item_id = ?1').bind(id).run();
      return;
    }
    await db
      .prepare(
        `INSERT INTO tracked (item_id, status, note, updated_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT (item_id) DO UPDATE SET status = excluded.status, note = excluded.note, updated_at = excluded.updated_at`,
      )
      .bind(id, status, note, now.toISOString())
      .run();
  };

// BM25 over title, body and party. The weights make a title match count most.
export const searchItems = (db: D1Database) => async ({ query, limit }: { query: string; limit: number }) =>
  parseRows(
    await db
      .prepare(
        `SELECT ${prefixed} FROM items_fts
         JOIN items ON items.rowid = items_fts.rowid
         WHERE items_fts MATCH ?1
         ORDER BY bm25(items_fts, 3.0, 1.0, 2.0)
         LIMIT ?2`,
      )
      .bind(query, limit)
      .all(),
  );

export const getCursor = (db: D1Database) => async (sourceId: string) =>
  z
    .object({ cursor: z.string().nullable() })
    .nullable()
    .parse(await db.prepare('SELECT cursor FROM source_state WHERE source_id = ?1').bind(sourceId).first())?.cursor ?? null;

export const recordRun =
  (db: D1Database) =>
  async (run: {
    sourceId: string;
    startedAt: Date;
    firstPage: boolean;
    finishedAt: Date;
    status: 'ok' | 'unchanged' | 'error';
    seen: number;
    added: number;
    dropped: number;
    error: string | null;
    cursor: string | null;
  }) => {
    const statements = [
      db
        .prepare(
          `INSERT INTO source_runs (source_id, started_at, finished_at, first_page, status, items_seen, items_new, items_dropped, error)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
        )
        .bind(run.sourceId, run.startedAt.toISOString(), run.finishedAt.toISOString(), run.firstPage ? 1 : 0, run.status, run.seen, run.added, run.dropped, run.error),
      ...(run.status === 'error'
        ? []
        : [
            db
              .prepare(
                `INSERT INTO source_state (source_id, cursor, last_ok_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT (source_id) DO UPDATE SET cursor = COALESCE(excluded.cursor, source_state.cursor), last_ok_at = excluded.last_ok_at`,
              )
              .bind(run.sourceId, run.cursor, run.finishedAt.toISOString()),
          ]),
    ];
    await db.batch(statements);
  };

const RunRow = z.object({
  source_id: z.string(),
  started_at: z.string(),
  status: z.string(),
  items_seen: z.number(),
  items_new: z.number(),
  items_dropped: z.number(),
  error: z.string().nullable(),
  pages: z.number(),
});

// The latest run of each source, with the counts of all its pages added.
export const latestRuns = (db: D1Database) => async () =>
  z.array(RunRow).parse(
    (
      await db
        .prepare(
          `WITH starts AS (SELECT source_id, MAX(started_at) AS started FROM source_runs WHERE first_page = 1 GROUP BY source_id)
           SELECT r.source_id, s.started AS started_at,
             CASE WHEN SUM(r.status = 'error') > 0 THEN 'error' WHEN SUM(r.status = 'ok') > 0 THEN 'ok' ELSE 'unchanged' END AS status,
             SUM(r.items_seen) AS items_seen, SUM(r.items_new) AS items_new, SUM(r.items_dropped) AS items_dropped,
             MAX(r.error) AS error, COUNT(*) AS pages
           FROM source_runs r JOIN starts s ON s.source_id = r.source_id AND r.started_at >= s.started
           GROUP BY r.source_id`,
        )
        .all()
    ).results,
  );

export const countUntagged = (db: D1Database) => async (version: number) =>
  z.object({ n: z.number() }).parse(await db.prepare(`SELECT COUNT(*) AS n FROM items WHERE ${UNTAGGED_SQL}`).bind(version).first()).n;

// Deletes stored records whose party fails `keep`. A stricter rule for
// personal information then also applies to records stored before it.
export const deleteParties =
  (db: D1Database) =>
  async ({ sourceId, keep }: { sourceId: string; keep: (party: string) => boolean }) => {
    const rows = z
      .array(z.object({ id: z.string(), party: z.string() }))
      .parse((await db.prepare('SELECT id, party FROM items WHERE source_id = ?1 AND party IS NOT NULL').bind(sourceId).all()).results);
    const remove = rows.filter((row) => !keep(row.party)).map((row) => row.id);
    if (remove.length > 0) await db.batch(remove.map((id) => db.prepare('DELETE FROM items WHERE id = ?1').bind(id)));
    return remove.length;
  };

// A null `useful` removes the label.
export const saveLabel =
  (db: D1Database) =>
  async ({ itemId: id, useful, now }: { itemId: string; useful: boolean | null; now: Date }) => {
    if (useful === null) {
      await db.prepare('DELETE FROM labels WHERE item_id = ?1').bind(id).run();
      return;
    }
    await db
      .prepare(
        `INSERT INTO labels (item_id, useful, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT (item_id) DO UPDATE SET useful = excluded.useful, updated_at = excluded.updated_at`,
      )
      .bind(id, useful ? 1 : 0, now.toISOString())
      .run();
  };

// The labels of the items on one page.
export const labelsFor = (db: D1Database) => async (ids: string[]): Promise<Map<string, boolean>> => {
  if (ids.length === 0) return new Map();
  const result = await db
    .prepare(`SELECT item_id, useful FROM labels WHERE item_id IN (${ids.map((_, i) => `?${i + 1}`).join(', ')})`)
    .bind(...ids)
    .all();
  return new Map(z.array(z.object({ item_id: z.string(), useful: z.number() })).parse(result.results).map((row) => [row.item_id, row.useful === 1]));
};

const LabelStatRow = z.object({ band: z.enum(['high', 'medium', 'low', 'hidden']), type: z.string().nullable(), n: z.number(), useful: z.number() });

// Labelled regulatory items with current tags, by priority band and item type.
export const labelStats = (db: D1Database) => async (version: number) =>
  LabelStatRow.array().parse(
    (
      await db
        .prepare(
          `SELECT ${PRIORITY_BAND_SQL} AS band, json_extract(answers, '$.itemType.choice') AS type, COUNT(*) AS n, SUM(labels.useful) AS useful
           FROM labels JOIN items ON items.id = labels.item_id
           WHERE kind = 'regulatory' AND tag_version = ?1
           GROUP BY band, type`,
        )
        .bind(version)
        .all()
    ).results,
  );

// Relevant regulatory items with a submission close date or a start date from `from` to `to`.
export const upcomingDates = (db: D1Database) => async ({ version, from, to }: { version: number; from: string; to: string }) => {
  const result = await db
    .prepare(
      `SELECT ${ITEM_COLUMNS}, ${PRIORITY_SQL} AS priority FROM items
       WHERE kind = 'regulatory' AND tag_version = ?1 AND ${IS_RELEVANT_SQL}
         AND ((closes_on >= ?2 AND closes_on <= ?3) OR (starts_on >= ?2 AND starts_on <= ?3))
       ORDER BY priority DESC LIMIT 500`,
    )
    .bind(version, from, to)
    .all();
  return parseRanked(result);
};

export type ReportQuery = { version: number; from: string; to: string };

const between = ({ kind, version, from, to }: ReportQuery & { kind: NewItem['kind'] }) =>
  clause('kind = ? AND tag_version = ? AND COALESCE(published_at, substr(first_seen_at, 1, 10)) BETWEEN ? AND ?', kind, version, from, to);

const ReportCounts = z.object({ high: z.number(), action: z.number(), submissions: z.number() });

// The facts for the quarterly report. Each list is short, thus the page stays one or two printed pages.
export const reportData = (db: D1Database) => async (q: ReportQuery) => {
  const reg = whereOf([between({ ...q, kind: 'regulatory' }), clause(IS_RELEVANT_SQL)]);
  const enf = whereOf([between({ ...q, kind: 'enforcement' }), clause(IS_WASTE_OPERATOR_SQL)]);
  const [counts, changes, named, groups] = await db.batch([
    db
      .prepare(
        `SELECT COALESCE(SUM(${PRIORITY_SQL} >= ${PRIORITY_HIGH}), 0) AS high,
           COALESCE(SUM(${flagSql('actionRequired')}), 0) AS action, COALESCE(SUM(${flagSql('submissionsOpen')}), 0) AS submissions
         FROM items WHERE ${reg.sql}`,
      )
      .bind(...reg.params),
    db
      .prepare(
        `SELECT ${ITEM_COLUMNS}, ${PRIORITY_SQL} AS priority FROM items
         WHERE ${reg.sql} AND (${PRIORITY_SQL} >= ${PRIORITY_HIGH} OR party_group IS 'jjr')
         ORDER BY party_group IS 'jjr' DESC, priority DESC LIMIT 15`,
      )
      .bind(...reg.params),
    db.prepare(`SELECT ${ITEM_COLUMNS} FROM items WHERE ${enf.sql} AND party_group IS NOT NULL ORDER BY published_at DESC LIMIT 40`).bind(...enf.params),
    groupCounts(db, enf),
  ]);
  return {
    counts: ReportCounts.parse(counts?.results[0]),
    changes: parseRanked(changes ?? { results: [] }),
    named: parseRows(named ?? { results: [] }),
    groups: GroupRow.array().parse(groups?.results ?? []),
  };
};
