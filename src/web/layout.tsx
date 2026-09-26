import type { Child } from 'hono/jsx';

const NAV = [
  { href: '/', label: 'Inbox' },
  { href: '/search', label: 'Search' },
] as const;

const INTRO_KEY = 'trashboard_intro';

// htmx swaps body, does not run script again: listeners on document.
const SCRIPT = `
const showIntro = () => {
  const intro = document.getElementById('intro');
  if (intro && !localStorage.getItem('${INTRO_KEY}')) intro.showModal();
};
showIntro();
document.addEventListener('htmx:afterSwap', showIntro);
document.addEventListener('close', (e) => { if (e.target.id === 'intro') localStorage.setItem('${INTRO_KEY}', '1'); }, true);
document.addEventListener('click', (e) => {
  if (e.target.id === 'intro') e.target.close();
  document.querySelectorAll('details.menu[open]').forEach((menu) => { if (!menu.contains(e.target)) menu.open = false; });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.querySelectorAll('details.menu[open]').forEach((menu) => { menu.open = false; menu.querySelector('summary').focus(); });
  if (e.key !== '/' || e.target.closest('input, select, textarea')) return;
  e.preventDefault();
  document.getElementById('q')?.focus();
});
`;

const MenuIcon = () => (
  <svg width="22" height="22" fill="none" aria-hidden="true" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" d="M3.8 6.8h16.5M3.8 12h16.5M3.8 17.3h16.5"/>
  </svg>
);

const Intro = () => (
  <dialog id="intro" aria-labelledby="intro-title">
    <div class="stack">
      <div class="stack-half">
        <img src="/assets/trashboard-icon-sm.png" height="100" width="100" alt="" />
        <h2 id="intro-title">Welcome to Trashboard</h2>
        <p>Waste industry law and enforcement news, fresh each morning.</p>
        <p>We dig through the rubbish so you don't have to. JJ Richards first, then the big stuff.</p>
        <p>Act on an item or chuck it. Type in the filter box to rummage by topic, place or company.</p>
        <p class="note">The AI can get things wrong. Check the source before you act.</p>
      </div>
      <form method="dialog">
        <button autofocus>Let's dig in</button>
      </form>
    </div>
  </dialog>
);

// htmx keeps first head: head must be same on each page.
// No history cache: Back fetches again, shows current triage.
export const Layout = ({ title, path, menu, children }: { title: string; path: string | null; menu?: Child; children: Child }) => (
  <html lang="en-AU">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, viewport-fit=cover, initial-scale=1.0, interactive-widget=resizes-content" />
      <meta name="robots" content="noindex" />
      <meta name="theme-color" content="#f6f6f3" media="(prefers-color-scheme: light)" />
      <meta name="theme-color" content="#131514" media="(prefers-color-scheme: dark)" />
      <meta name="mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-title" content="Trashboard" />
      <meta name="apple-mobile-web-app-status-bar-style" content="default" />
      <link rel="manifest" href="/manifest.webmanifest" />
      <link rel="icon" type="image/png" href="/assets/icon-192.png" />
      <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png" />
      <title>{`${title} · Trashboard`}</title>
      <meta name="htmx-config" content='{"historyCacheSize":0}' />
      <link rel="stylesheet" href="/assets/styles.css" />
      <script src="/assets/htmx-2.0.11.min.js" defer />
      <script src="/assets/omnibar.js" defer />
      <script type="module" dangerouslySetInnerHTML={{ __html: SCRIPT }} />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
      <link href="https://fonts.googleapis.com/css2?family=Fira+Sans:ital,wght@0,100..900;1,100..900&display=swap" rel="stylesheet" />
    </head>
    <body hx-boost="true">
      {path !== null && (
        <header class="top inline-wrap">
          <div class="brand inline-zero"><img src="/assets/trashboard-icon-sm.png" alt="" /> Trashboard</div>
          <nav class="inline" aria-label="Main">
            {NAV.map((link) => (
              <a href={link.href} class={path === link.href ? 'on' : ''} aria-current={path === link.href ? 'page' : undefined}>
                {link.label}
              </a>
            ))}
          </nav>
          <details class="menu">
            <summary aria-label="Menu" title="Menu">
              <MenuIcon />
            </summary>
            <div class="items stack-zero">
              {menu}
              <button type="button" onclick="document.getElementById('intro').showModal()">Show welcome</button>
              <a href="/sources">Sources</a>
              <a href="/logout">Log out</a>
            </div>
          </details>
        </header>
      )}
      <main class="page stack">{children}</main>
      {path !== null && <Intro />}
    </body>
  </html>
);
