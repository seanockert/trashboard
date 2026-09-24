import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { z } from 'zod';
import { TrackStatus } from '../items';
import {
  countUntagged,
  enforcementPage,
  labelsFor,
  labelStats,
  latestRuns,
  regulatoryPage,
  reportData,
  saveLabel,
  saveTracking,
  trackedItems,
  trackingFor,
  upcomingDates,
} from '../db';
import { readSecrets } from '../env';
import { TAG_VERSION } from '../jev/questions';
import { makeClient } from '../jev/tag';
import { retagStale, scheduleAll, summariseStale } from '../pipeline';
import { ftsFilter, search } from '../search';
import { SOURCES } from '../sources';
import { checkPassword, endSession, requireSession, safeNext, startSession } from './auth';
import {
  bandStats,
  brisbaneDay,
  changesFlags,
  dateEntries,
  groupTable,
  offenceChips,
  PAGE_SIZE,
  parseChangesFilters,
  parseEnforcementFilters,
  penaltyBenchmarks,
  Quarter,
  quarterOf,
  quarterRange,
  recentQuarters,
  sinceDate,
  toChangeRows,
  toEnforcementRows,
} from './models';
import {
  AboutPage,
  ChangesPage,
  DEADLINE_PERIODS,
  DeadlinesPage,
  EnforcementPage,
  LabelsPage,
  LoginPage,
  ReportPage,
  SearchPage,
  SourcesPage,
  TrackedPage,
} from './pages';

export const app = new Hono<{ Bindings: Env }>();

app.use('*', secureHeaders());

app.get('/login', (c) => c.html(<LoginPage next={safeNext(c.req.query('next'))} error={c.req.query('failed') === '1' ? 'The password is not correct.' : null} />));

app.post('/login', async (c) => {
  const { success: allowed } = await c.env.LOGIN_LIMIT.limit({ key: c.req.header('cf-connecting-ip') ?? 'unknown' });
  if (!allowed) return c.html(<LoginPage next="/changes" error="Too many attempts. Wait one minute, then try again." />, 429);
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

app.get('/', (c) => c.redirect('/changes'));

app.get('/changes', async (c) => {
  const filters = parseChangesFilters(c.req.query());
  const result = await regulatoryPage(c.env.DB)({
    since: sinceDate(filters.picked.days, new Date()),
    version: TAG_VERSION,
    jurisdiction: filters.picked.jurisdiction,
    company: filters.picked.company,
    flags: changesFlags(filters),
    match: ftsFilter(filters.text),
    relevantOnly: filters.all !== '1',
    limit: PAGE_SIZE,
    offset: (filters.page - 1) * PAGE_SIZE,
  });
  const ids = result.rows.map((r) => r.item.id);
  const [tracking, labels] = await Promise.all([trackingFor(c.env.DB)(ids), labelsFor(c.env.DB)(ids)]);
  return c.html(<ChangesPage rows={toChangeRows(result.rows)} matched={result.matched} filters={filters} tracking={tracking} labels={labels} />);
});

app.get('/enforcement', async (c) => {
  const filters = parseEnforcementFilters(c.req.query());
  const result = await enforcementPage(c.env.DB)({
    since: sinceDate(filters.picked.days, new Date()),
    version: TAG_VERSION,
    jurisdiction: filters.picked.jurisdiction,
    wasteOnly: filters.industry === 'waste',
    group: filters.picked.group,
    offence: filters.picked.offence,
    match: ftsFilter(filters.text),
    limit: PAGE_SIZE,
    offset: (filters.page - 1) * PAGE_SIZE,
  });
  const model = {
    groups: groupTable(result.groups),
    offences: offenceChips(result.offences),
    penalties: penaltyBenchmarks(result.penalties),
    list: toEnforcementRows(result.rows),
    matched: result.matched,
  };
  const tracking = await trackingFor(c.env.DB)(result.rows.map((item) => item.id));
  return c.html(<EnforcementPage model={model} filters={filters} tracking={tracking} />);
});

app.get('/search', async (c) => {
  const query = (c.req.query('q') ?? '').trim().slice(0, 300);
  if (query === '') return c.html(<SearchPage query="" result={null} tracking={new Map()} />);
  const result = await search({ db: c.env.DB, client: makeClient(readSecrets(c.env).TYPESAFE_API_KEY) })(query);
  console.log(JSON.stringify({ event: 'search', shortlist: result.shortlist, hits: result.hits.length, ms: result.ms, costUsd: result.costUsd }));
  const tracking = await trackingFor(c.env.DB)(result.hits.map((hit) => hit.item.id));
  return c.html(<SearchPage query={query} result={result} tracking={tracking} />);
});

app.get('/tracked', async (c) => c.html(<TrackedPage rows={await trackedItems(c.env.DB)()} />));

// Saves the status and note of one item. "stop" removes the tracking.
app.post('/track', async (c) => {
  const form = z
    .object({ itemId: z.string().min(1).max(500), status: TrackStatus, note: z.string().max(500).default(''), stop: z.literal('1').optional(), back: z.string().optional() })
    .safeParse(await c.req.parseBody());
  if (!form.success) return c.text('Bad request', 400);
  const { itemId, status, note, stop, back } = form.data;
  await saveTracking(c.env.DB)({ itemId, status: stop === '1' ? null : status, note: note.trim(), now: new Date() });
  return c.redirect(safeNext(back));
});

const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);

const DeadlineFilters = z.object({ days: z.coerce.number().pipe(z.union(DEADLINE_PERIODS.map(([d]) => z.literal(d)))).catch(90) });

app.get('/deadlines', async (c) => {
  const { days } = DeadlineFilters.parse(c.req.query());
  const now = new Date();
  const range = { from: brisbaneDay(now), to: brisbaneDay(addDays(now, days)) };
  const rows = toChangeRows(await upcomingDates(c.env.DB)({ version: TAG_VERSION, ...range }));
  return c.html(<DeadlinesPage entries={dateEntries({ rows, ...range })} days={days} />);
});

app.post('/label', async (c) => {
  const form = z
    .object({ itemId: z.string().min(1).max(500), useful: z.enum(['1', '0', 'clear']), back: z.string().optional() })
    .safeParse(await c.req.parseBody());
  if (!form.success) return c.text('Bad request', 400);
  const { itemId, useful, back } = form.data;
  await saveLabel(c.env.DB)({ itemId, useful: useful === 'clear' ? null : useful === '1', now: new Date() });
  return c.redirect(safeNext(back));
});

app.get('/labels', async (c) => c.html(<LabelsPage stats={bandStats(await labelStats(c.env.DB)(TAG_VERSION))} />));

const REPORT_QUARTERS = 8;
const REPORT_DATE_DAYS = 90;

app.get('/report', async (c) => {
  const now = new Date();
  const quarters = recentQuarters(now, REPORT_QUARTERS);
  const asked = Quarter.safeParse(c.req.query('quarter'));
  const quarter = asked.success && quarters.includes(asked.data) ? asked.data : quarterOf(now);
  const { from, to, label } = quarterRange(quarter);
  const dateRange = { from: brisbaneDay(now), to: brisbaneDay(addDays(now, REPORT_DATE_DAYS)) };
  const [data, dated, tracked] = await Promise.all([
    reportData(c.env.DB)({ version: TAG_VERSION, from, to }),
    upcomingDates(c.env.DB)({ version: TAG_VERSION, ...dateRange }),
    trackedItems(c.env.DB)(),
  ]);
  const model = {
    quarter,
    quarters,
    label,
    counts: data.counts,
    changes: toChangeRows(data.changes),
    dates: dateEntries({ rows: toChangeRows(dated), ...dateRange }),
    named: data.named,
    groups: groupTable(data.groups),
    acting: tracked.filter((row) => row.tracking.status === 'acting'),
  };
  return c.html(<ReportPage model={model} />);
});

app.get('/about', (c) => c.html(<AboutPage sources={SOURCES.length} />));

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

// Starts a run now, without a wait for the daily schedule.
app.post('/sources/run', async (c) => {
  await scheduleAll(c.env);
  return c.redirect('/sources');
});

// Loads the past 12 months from each source that can go back in time.
// Items that are stored already do not get new tags.
const BACKFILL_DAYS = 365;

app.post('/sources/backfill', async (c) => {
  await scheduleAll(c.env, new Date(Date.now() - BACKFILL_DAYS * 86_400_000).toISOString());
  return c.redirect('/sources');
});

// Sends every item without current tags to the queue again, and the tagged
// items that have no current summary. A new tag makes its summary too.
app.post('/sources/retag', async (c) => {
  await Promise.all([retagStale({ env: c.env, limit: 5000, minAgeHours: 0 }), summariseStale({ env: c.env, limit: 1000 })]);
  return c.redirect('/sources');
});
