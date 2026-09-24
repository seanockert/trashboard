import type { Child } from 'hono/jsx';

const CSS = `
:root {
  --bg: #f7f7f5; --panel: #ffffff; --text: #1d1f21; --muted: #62676d; --line: #e2e2de;
  --accent: #1f6f5c; --accent-soft: #e3f1ec; --warn: #9a5b00; --warn-soft: #fbefdc; --bad: #a33a2b;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #141615; --panel: #1c1f1e; --text: #e6e7e5; --muted: #a0a6a3; --line: #2e3331;
    --accent: #6cc4a8; --accent-soft: #1d332c; --warn: #e3a64a; --warn-soft: #3a2c16; --bad: #ec8b7c;
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 17px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
a { color: var(--accent); }
.top { display: flex; gap: 24px; align-items: center; padding: 14px 24px; border-bottom: 1px solid var(--line); background: var(--panel); flex-wrap: wrap; }
.top .brand { font-weight: 700; font-size: 20px; margin-right: auto; display: flex; align-items: center; }
.top .brand img { height: 3rem; margin-block: -4px; }
.top a { text-decoration: none; color: var(--muted); }
.top a.on { color: var(--text); font-weight: 600; }
.page { max-width: 1100px; margin: 0 auto; padding: 32px 16px 64px; }
h1 { font-size: 34px; line-height: 1.2; margin: 0 0 8px; }
.sub { color: var(--muted); font-size: 19px; margin: 0 0 24px; }
.count { font-weight: 600; margin: 0 0 12px; }
form.filters { display: flex; flex-wrap: wrap; gap: 12px 16px; align-items: end; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 16px; margin-bottom: 24px; }
form.filters label { display: flex; flex-direction: column; font-size: 15px; color: var(--muted); gap: 4px; }
select, input, button { font: inherit; color: var(--text); background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; }
button { background: var(--accent); color: var(--panel); border-color: var(--accent); cursor: pointer; }
.card { position: relative; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 18px 56px 18px 22px; margin-bottom: 14px; }
.card .meta { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 15px; color: var(--muted); }
.card .title { display: block; font-size: 21px; font-weight: 650; line-height: 1.3; color: var(--text); text-decoration: none; margin: 6px 0 8px; }
.card .title:hover { color: var(--accent); text-decoration: underline; }
.card .body { font-size: 16px; color: var(--muted); white-space: pre-line; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; }
.card .summary { font-size: 16px; }
.card .summary p { margin: 0; }
.card .summary ul { margin: 4px 0 0; padding-left: 20px; color: var(--muted); }
.tags { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.tag { font-size: 14px; padding: 2px 10px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); }
.tag.warn { background: var(--warn-soft); color: var(--warn); }
a.tag { text-decoration: none; }
a.tag:hover { outline: 1px solid currentColor; }
a.tag.on { outline: 2px solid currentColor; }
.prio { font-weight: 600; padding: 0 8px; border-radius: 4px; }
.prio.high { background: var(--accent); color: var(--panel); }
.prio.medium { background: var(--accent-soft); color: var(--accent); }
.prio.low { background: var(--line); color: var(--muted); }
.top .search { display: flex; flex: 1 1 220px; max-width: 360px; margin: 0; }
.top .search input { width: 100%; padding: 6px 10px; }
.menu { position: relative; }
.menu summary { list-style: none; cursor: pointer; color: var(--muted); display: flex; padding: 4px; border-radius: 6px; }
.menu summary::-webkit-details-marker { display: none; }
.menu summary:hover, .menu[open] summary { color: var(--text); background: var(--bg); }
.menu .items { position: absolute; right: 0; top: calc(100% + 6px); z-index: 10; min-width: 180px; display: flex; flex-direction: column; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 6px; box-shadow: 0 6px 20px rgb(0 0 0 / 0.12); }
.menu .items a, .menu .items button { display: block; text-align: left; padding: 8px 10px; border-radius: 6px; color: var(--text); background: none; border: 0; font-size: 16px; }
.menu .items a:hover, .menu .items button:hover { background: var(--bg); }
dialog { max-width: 30rem; border: 1px solid var(--line); border-radius: 12px; padding: 28px; background: var(--panel); color: var(--text); }
dialog::backdrop { background: rgb(0 0 0 / 0.45); backdrop-filter: blur(3px); }
dialog h2 { margin: 0 0 12px; font-size: 26px; }
dialog p { margin: 0 0 12px; }
dialog .actions { display: flex; gap: 16px; align-items: center; justify-content: flex-end; margin-top: 20px; }
.bookmark { position: absolute; top: 12px; right: 12px; }
.bookmark summary { list-style: none; cursor: pointer; display: flex; padding: 4px; border-radius: 6px; color: var(--muted); }
.bookmark summary::-webkit-details-marker { display: none; }
.bookmark summary:hover, .bookmark[open] summary { color: var(--accent); background: var(--bg); }
.bookmark.watching summary { color: var(--accent); }
.bookmark.acting summary { color: var(--warn); }
.bookmark form { position: absolute; right: 0; top: calc(100% + 6px); z-index: 10; width: min(360px, 80vw); display: flex; flex-direction: column; gap: 8px; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 12px; font-size: 15px; box-shadow: 0 6px 20px rgb(0 0 0 / 0.12); }
.track-status { display: flex; gap: 16px; }
.bookmark textarea { font: inherit; color: var(--text); background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; resize: vertical; }
.track-actions { display: flex; gap: 8px; }
.track { display: flex; gap: 10px; align-items: baseline; margin-top: 12px; border-top: 1px solid var(--line); padding-top: 10px; font-size: 15px; }
.track-note { color: var(--text); white-space: pre-line; }
.pill { font-weight: 600; padding: 0 8px; border-radius: 4px; }
.pill.watching { background: var(--accent-soft); color: var(--accent); }
.pill.acting { background: var(--warn-soft); color: var(--warn); }
button.secondary { background: none; color: var(--muted); border-color: var(--line); }
.page > h2 { font-size: 22px; margin: 28px 0 12px; }
.about h2 { font-size: 24px; margin: 32px 0 8px; }
.about li { margin-bottom: 6px; }
table { width: 100%; border-collapse: collapse; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; margin-bottom: 16px; }
th, td { text-align: left; padding: 10px 14px; border-bottom: 1px solid var(--line); font-size: 16px; }
th { color: var(--muted); font-weight: 600; font-size: 14px; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
tr.self td { font-weight: 650; }
.scroll { overflow-x: auto; }
.empty { color: var(--muted); padding: 24px; text-align: center; background: var(--panel); border: 1px dashed var(--line); border-radius: 8px; }
.note { font-size: 15px; color: var(--muted); }
.login { max-width: 340px; margin: 12vh auto; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 24px; display: flex; flex-direction: column; gap: 12px; }
.login h1 { display: flex; align-items: center; gap: 0.75rem; }
.login h1 img { height: 3rem; margin-block: -4px; }
.error { color: var(--bad); }
.pager { display: flex; justify-content: space-between; align-items: center; margin-top: 16px; }
.nowrap { white-space: nowrap; }
td .title { font-weight: 600; color: var(--text); }
form.label { display: flex; gap: 8px; align-items: center; justify-content: flex-end; margin-top: 12px; }
form.label button { padding: 2px 12px; font-size: 14px; }
form.label button.on { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); font-weight: 600; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 8px; }
.stat { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; }
.stat .value { font-size: 32px; font-weight: 700; line-height: 1.1; font-variant-numeric: tabular-nums; }
.report-list { padding-left: 20px; }
.report-list li { margin-bottom: 12px; }
@media print {
  .top, .no-print, dialog, .bookmark, form.label { display: none !important; }
  body { background: #fff; color: #000; font-size: 12pt; }
  .page { padding: 0; max-width: none; }
  .stat, table { border-color: #999; }
  a { color: #000; }
}
`;

const NAV = [
  { href: '/changes', label: 'Regulatory changes' },
  { href: '/enforcement', label: 'Enforcement' },
  { href: '/deadlines', label: 'Deadlines' },
  { href: '/tracked', label: 'Bookmarks' },
  { href: '/report', label: 'Report' },
] as const;

const INTRO_KEY = 'trashboard_intro';

// Shows the intro one time, closes the settings menu and bookmark forms on an outside click,
// and puts the cursor in the search box when the user types "/".
const SCRIPT = `
const intro = document.getElementById('intro');
if (intro && !localStorage.getItem('${INTRO_KEY}')) intro.showModal();
intro?.addEventListener('close', () => localStorage.setItem('${INTRO_KEY}', '1'));
intro?.addEventListener('click', (e) => { if (e.target === intro) intro.close(); });
document.addEventListener('click', (e) => {
  document.querySelectorAll('details.menu[open], details.bookmark[open]').forEach((menu) => { if (!menu.contains(e.target)) menu.open = false; });
});
document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.target.closest('input, select, textarea')) return;
  e.preventDefault();
  document.getElementById('q')?.focus();
});
`;

const CogIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);

const Intro = () => (
  <dialog id="intro" aria-labelledby="intro-title">
    <h2 id="intro-title">Welcome to Trashboard</h2>
    <p>Waste industry law and enforcement news, updated each morning.</p>
    <p>Cut through the noise. See only what affects waste, most important first.</p>
    <p>Click a tag to filter.</p>
    <form method="dialog" class="actions">
      <a href="/about">How it works</a>
      <button autofocus>Start</button>
    </form>
  </dialog>
);

export const Layout = ({ title, path, query = '', children }: { title: string; path: string | null; query?: string; children: Child }) => (
  <html lang="en-AU">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, viewport-fit=cover, initial-scale=1.0, interactive-widget=resizes-content" />
      <meta name="robots" content="noindex" />
      <link rel="shortcut icon" href="/assets/trashboard-icon-sm.png" />
      <title>{`${title} · Trashboard`}</title>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
    </head>
    <body>
      {path !== null && (
        <nav class="top">
          <div class="brand"><img src="/assets/trashboard-icon-sm.png" /> Trashboard</div>
          {NAV.map((link) => (
            <a href={link.href} class={path.startsWith(link.href) ? 'on' : ''}>
              {link.label}
            </a>
          ))}
          <form class="search" method="get" action="/search" role="search">
            <input type="search" id="q" name="q" value={query} placeholder="Search or ask a question" aria-label="Search" />
          </form>
          <details class="menu">
            <summary aria-label="Settings" title="Settings">
              <CogIcon />
            </summary>
            <div class="items">
              <a href="/about">About Trashboard</a>
              <button type="button" onclick="document.getElementById('intro').showModal()">Show welcome</button>
              <a href="/labels">Priority check</a>
              <a href="/sources">Sources and runs</a>
              <a href="/logout">Log out</a>
            </div>
          </details>
        </nav>
      )}
      <main class="page">{children}</main>
      {path !== null && <Intro />}
      {path !== null && <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />}
    </body>
  </html>
);
