// Runs locally: CloudFront blocks Cloudflare, so worker cannot fetch SA EPA.
// Usage: TRASHBOARD_URL=https://... DASHBOARD_PASSWORD=... bun run relay:sa
import { saPageUrl } from '../src/sources/licences';
import { BROWSER_USER_AGENT } from '../src/sources/http';

const base = process.env.TRASHBOARD_URL;
const password = process.env.DASHBOARD_PASSWORD;
if (!base || !password) throw new Error('Set TRASHBOARD_URL and DASHBOARD_PASSWORD.');

// One login for all pages; avoids login rate limit.
const login = await fetch(new URL('/login', base), { method: 'POST', body: new URLSearchParams({ password }), redirect: 'manual' });
const cookie = login.headers.getSetCookie().find((c) => c.startsWith('trashboard_session='))?.split(';')[0];
if (cookie === undefined) throw new Error(`Login failed: HTTP ${login.status}`);

type State = { page: number; newest: string | null } | null;

let state: State = null;
do {
  const page = state?.page ?? 0;
  const res = await fetch(saPageUrl(page), { headers: { 'user-agent': BROWSER_USER_AGENT, accept: 'application/json, text/javascript, */*' } });
  if (!res.ok) throw new Error(`SA EPA page ${page}: HTTP ${res.status}`);
  const relay = await fetch(new URL('/relay/sa', base), {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ state, body: await res.text() }),
    redirect: 'manual',
  });
  if (!relay.ok) throw new Error(`Worker, page ${page}: HTTP ${relay.status}`);
  const result = (await relay.json()) as { next: State; error: string | null };
  if (result.error !== null) throw new Error(`Worker, page ${page}: ${result.error}`);
  console.log(`Page ${page} sent.`);
  state = result.next;
} while (state !== null);
console.log('Done.');
