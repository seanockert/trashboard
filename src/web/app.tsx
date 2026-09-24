import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { z } from 'zod';
import { TriageStatus } from '../items';
import { countUntagged, dueItems, inboxPage, latestRuns, reportData, saveTriage, triageFor } from '../db';
import { readSecrets } from '../env';
import { TAG_VERSION } from '../jev/questions';
import { makeClient } from '../jev/tag';
import { updateAll } from '../pipeline';
import { search } from '../search';
import { SOURCES } from '../sources';
import { checkPassword, endSession, requireSession, safeNext, startSession } from './auth';
import {
  addDays,
  brisbaneDay,
  dateEntries,
  DEFAULT_PERIOD,
  groupTable,
  hitPenalties,
  inboxFields,
  PAGE_SIZE,
  parseInboxFilters,
  penaltyBenchmarks,
  periodRange,
  quarterOf,
  scopeOf,
  toRows,
} from './models';
import { DUE_DAYS, InboxPage, LoginPage, REPORT_DATE_DAYS, ReportView, SearchPage, SourcesPage } from './pages';

export const app = new Hono<{ Bindings: Env }>();

app.use('*', secureHeaders());

app.get('/login', (c) => c.html(<LoginPage next={safeNext(c.req.query('next'))} error={c.req.query('failed') === '1' ? 'Wrong password. Nice try.' : null} />));

app.post('/login', async (c) => {
  const { success: allowed } = await c.env.LOGIN_LIMIT.limit({ key: c.req.header('cf-connecting-ip') ?? 'unknown' });
  if (!allowed) return c.html(<LoginPage next="/" error="Too many tries. Take a minute, then have another go." />, 429);
  const form = z.object({ password: z.string(), next: z.string().optional() }).safeParse(await c.req.parseBody());
  const next = safeNext(form.success ? form.data.next : undefined);
  if (!form.success || !(await checkPassword({ env: c.env, password: form.data.password }))) {
    return c.redirect(`/login?failed=1&next=${encodeURIComponent(next)}`);
  }
  await startSession(c);
  return c.redirect(next);
});

app.get('/logout', endSession, (c) => c.redirect('/login'));

app.use('*', requireSession);

// The dates from today to `days` from today, in Brisbane.
const nextDays = (now: Date, days: number) => ({ from: brisbaneDay(now), to: brisbaneDay(addDays(now, days)) });

// The inbox. With "view=report", the same filters as a page to print.
app.get('/', async (c) => {
  const now = new Date();
  const fields = inboxFields(now);
  const filters = parseInboxFilters(c.req.query(), now);
  const scope = scopeOf(filters, now, TAG_VERSION);
  if (filters.view === 'report') {
    const period = periodRange(filters.picked.period ?? quarterOf(now), now);
    const dates = nextDays(now, REPORT_DATE_DAYS);
    const [data, due] = await Promise.all([reportData(c.env.DB)({ scope: { ...scope, period } }), dueItems(c.env.DB)({ scope, dates })]);
    const model = {
      label: period.label,
      counts: data.counts,
      top: toRows(data.top),
      dates: dateEntries({ rows: toRows(due), ...dates }),
      groups: groupTable(data.groups),
      acting: toRows(data.acting),
    };
    return c.html(<ReportView model={model} filters={filters} fields={fields} />);
  }
  const dates = nextDays(now, DUE_DAYS);
  const [page, due] = await Promise.all([
    inboxPage(c.env.DB)({ scope, defaultPeriod: periodRange(DEFAULT_PERIOD, now), tab: filters.tab, limit: PAGE_SIZE, offset: (filters.page - 1) * PAGE_SIZE }),
    filters.tab === 'done' ? Promise.resolve([]) : dueItems(c.env.DB)({ scope, dates, actingOnly: filters.tab === 'acting' }),
  ]);
  const model = { rows: toRows(page.rows), counts: page.counts, due: dateEntries({ rows: toRows(due), ...dates }), reportQuarter: quarterOf(now) };
  return c.html(<InboxPage model={model} filters={filters} fields={fields} />);
});

app.get('/search', async (c) => {
  const now = new Date();
  const fields = inboxFields(now);
  const filters = parseInboxFilters({}, now);
  const query = (c.req.query('q') ?? '').trim().slice(0, 300);
  if (query === '') return c.html(<SearchPage model={{ query, result: null, rows: [], scores: new Map(), penalties: [] }} filters={filters} fields={fields} />);
  const result = await search({ db: c.env.DB, client: makeClient(readSecrets(c.env).TYPESAFE_API_KEY) })(query);
  console.log(JSON.stringify({ event: 'search', shortlist: result.shortlist, hits: result.hits.length, ms: result.ms, costUsd: result.costUsd }));
  const triage = await triageFor(c.env.DB)(result.hits.map((hit) => hit.item.id));
  const model = {
    query,
    result,
    rows: toRows(result.hits.map(({ item }) => ({ item, priority: 0, triage: triage.get(item.id) ?? null }))),
    scores: new Map(result.hits.map((hit) => [hit.item.id, hit.score])),
    penalties: penaltyBenchmarks(hitPenalties(result.hits.map((hit) => hit.item))),
  };
  return c.html(<SearchPage model={model} filters={filters} fields={fields} />);
});

// Saves the status of one item. "new" makes it new again. A form with no note keeps the stored note.
app.post('/triage', async (c) => {
  const form = z
    .object({ itemId: z.string().min(1).max(500), status: z.union([TriageStatus, z.literal('new')]), note: z.string().max(500).optional(), back: z.string().optional() })
    .safeParse(await c.req.parseBody());
  if (!form.success) return c.text('Bad request', 400);
  const { itemId, status, note, back } = form.data;
  await saveTriage(c.env.DB)({ itemId, status: status === 'new' ? null : status, note: note?.trim() ?? null, now: new Date() });
  return c.redirect(safeNext(back));
});

app.get('/sources', async (c) => {
  const [runs, pending] = await Promise.all([latestRuns(c.env.DB)(), countUntagged(c.env.DB)(TAG_VERSION)]);
  const rows = SOURCES.map((source) => {
    const run = runs.find((r) => r.source_id === source.id);
    return {
      id: source.id,
      name: source.name,
      homepage: source.homepage,
      kind: source.kind,
      lastRun: run?.started_at ?? null,
      status: run?.status ?? null,
      pages: run?.pages ?? 0,
      seen: run?.items_seen ?? 0,
      added: run?.items_new ?? 0,
      dropped: run?.items_dropped ?? 0,
      error: run?.error ?? null,
    };
  });
  return c.html(<SourcesPage rows={rows} pending={pending} />);
});

// Does the daily run now: new items from each source, then tags and summaries.
app.post('/sources/update', async (c) => {
  await updateAll(c.env);
  return c.redirect('/sources');
});
