import type { Child } from 'hono/jsx';

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
    <div class="stack">
      <h2 id="intro-title">Welcome to Trashboard</h2>
      <p>Waste industry law and enforcement news, updated each morning.</p>
      <p>Cut through the noise. See only what affects waste, most important first.</p>
      <p>Click a tag to filter.</p>
      <form method="dialog" class="actions inline">
        <a href="/about">How it works</a>
        <button autofocus>Start</button>
      </form>
    </div>
  </dialog>
);

// `search` is false on a page that has its own omni-bar, thus the page shows one search input only.
export const Layout = ({ title, path, query = '', search = true, children }: { title: string; path: string | null; query?: string; search?: boolean; children: Child }) => (
  <html lang="en-AU">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, viewport-fit=cover, initial-scale=1.0, interactive-widget=resizes-content" />
      <meta name="robots" content="noindex" />
      <link rel="shortcut icon" href="/assets/trashboard-icon-sm.png" />
      <title>{`${title} · Trashboard`}</title>
      <link rel="stylesheet" href="/assets/styles.css" />
    </head>
    <body>
      {path !== null && (
        <nav class="top inline-2x inline-wrap">
          <div class="brand inline-zero"><img src="/assets/trashboard-icon-sm.png" alt="" /> Trashboard</div>
          {NAV.map((link) => (
            <a href={link.href} class={path.startsWith(link.href) ? 'on' : ''} aria-current={path.startsWith(link.href) ? 'page' : undefined}>
              {link.label}
            </a>
          ))}
          {search && (
            <form class="search" method="get" action="/search" role="search">
              <input type="search" id="q" name="q" value={query} placeholder="Search or ask a question" aria-label="Search" />
            </form>
          )}
          <details class="menu">
            <summary aria-label="Settings" title="Settings">
              <CogIcon />
            </summary>
            <div class="items stack-zero">
              <a href="/about">About Trashboard</a>
              <button type="button" onclick="document.getElementById('intro').showModal()">Show welcome</button>
              <a href="/labels">Priority check</a>
              <a href="/sources">Sources and runs</a>
              <a href="/logout">Log out</a>
            </div>
          </details>
        </nav>
      )}
      <main class="page stack">{children}</main>
      {path !== null && <Intro />}
      {path !== null && <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />}
    </body>
  </html>
);
