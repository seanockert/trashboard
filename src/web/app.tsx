import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { z } from 'zod';
import { countUntagged, enforcementPage, latestRuns, regulatoryPage } from '../db';
import { readSecrets } from '../env';
import { TAG_VERSION } from '../jev/questions';
import { makeClient } from '../jev/tag';
import { retagStale, scheduleAll } from '../pipeline';
import { search } from '../search';
import { SOURCES } from '../sources';
import { checkPassword, endSession, requireSession, startSession } from './auth';
import {
  ChangesFilters,
  changesFlags,
  EnforcementFilters,
  groupTable,
  offenceChips,
  PAGE_SIZE,
  sinceDate,
  toChangeRows,
  toEnforcementRows,
} from './models';
import { ChangesPage, EnforcementPage, LoginPage, SearchPage, SourcesPage } from './pages';

export const app = new Hono<{ Bindings: Env }>();

app.use('*', secureHeaders());

// Only a local path is a safe place to send the user after login.
const safeNext = (next: unknown) => (typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/changes');

app.get('/login', (c) => c.html(<LoginPage next={safeNext(c.req.query('next'))} failed={c.req.query('failed') === '1'} />));

app.post('/login', async (c) => {
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
  const filters = ChangesFilters.parse(c.req.query());
  const result = await regulatoryPage(c.env.DB)({
    since: sinceDate(filters.days, new Date()),
    version: TAG_VERSION,
    jurisdiction: filters.jurisdiction,
    flags: changesFlags(filters),
    relevantOnly: filters.all !== '1',
    limit: PAGE_SIZE,
    offset: (filters.page - 1) * PAGE_SIZE,
  });
  return c.html(<ChangesPage rows={toChangeRows(result.rows)} matched={result.matched} filters={filters} />);
});

app.get('/enforcement', async (c) => {
  const filters = EnforcementFilters.parse(c.req.query());
  const result = await enforcementPage(c.env.DB)({
    since: sinceDate(filters.days, new Date()),
    version: TAG_VERSION,
    jurisdiction: filters.jurisdiction,
    wasteOnly: filters.industry === 'waste',
    group: filters.group,
    offence: filters.offence,
    limit: PAGE_SIZE,
    offset: (filters.page - 1) * PAGE_SIZE,
  });
  const model = { groups: groupTable(result.groups), offences: offenceChips(result.offences), list: toEnforcementRows(result.rows), matched: result.matched };
  return c.html(<EnforcementPage model={model} filters={filters} />);
});

app.get('/search', async (c) => {
  const query = (c.req.query('q') ?? '').trim().slice(0, 300);
  if (query === '') return c.html(<SearchPage query="" result={null} />);
  const result = await search({ db: c.env.DB, client: makeClient(readSecrets(c.env).TYPESAFE_API_KEY) })(query);
  console.log(JSON.stringify({ event: 'search', shortlist: result.shortlist, hits: result.hits.length, ms: result.ms, costUsd: result.costUsd }));
  return c.html(<SearchPage query={query} result={result} />);
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

// Starts a run now, without a wait for the daily schedule.
app.post('/sources/run', async (c) => {
  await scheduleAll(c.env);
  return c.redirect('/sources');
});

// Sends every item without current tags to the queue again.
app.post('/sources/retag', async (c) => {
  await retagStale({ env: c.env, limit: 5000, minAgeHours: 0 });
  return c.redirect('/sources');
});
