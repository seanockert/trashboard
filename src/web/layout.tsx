import type { Child } from 'hono/jsx';

const NAV = [
  { href: '/', label: 'Inbox' },
  { href: '/search', label: 'Search' },
] as const;

const INTRO_KEY = 'trashboard_intro';

// Shows the intro one time, closes the settings menu on an outside click,
// and puts the cursor in the search box of the page when the user types "/".
// htmx swaps the body and does not run this script again, thus the listeners are on the document.
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
  if (e.key !== '/' || e.target.closest('input, select, textarea')) return;
  e.preventDefault();
  document.getElementById('q')?.focus();
});
`;

const MenuIcon = () => (
  <svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
    <path stroke-linecap="round" stroke-linejoin="round" d="M3.8 6.8h16.5M3.8 12h16.5M3.8 17.3h16.5"/>
  </svg>
);

const Intro = () => (
  <dialog id="intro" aria-labelledby="intro-title">
    <div class="stack">
      <h2 id="intro-title">Welcome to Trashboard</h2>
      <p>Waste industry law and enforcement news, fresh each morning.</p>
      <p>We dig through the rubbish so you don’t have to. JJ Richards first, then the big stuff.</p>
      <p>Act on an item or chuck it. Type in the filter box to rummage by topic, place or company.</p>
      <p class="note">The AI can get things wrong. Check the source before you act.</p>
      <form method="dialog" class="actions inline">
        <button autofocus>Let’s dig in</button>
      </form>
    </div>
  </dialog>
);

// `menu` gives more links for the page at the top of the settings menu.
// hx-boost fetches each link and form of the page and swaps the body, thus the page does not reload.
// htmx keeps the head of the first page, thus the head must be the same on each page.
// No history cache: Back fetches the page again, thus it shows the current triage.
export const Layout = ({ title, path, menu, children }: { title: string; path: string | null; menu?: Child; children: Child }) => (
  <html lang="en-AU">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, viewport-fit=cover, initial-scale=1.0, interactive-widget=resizes-content" />
      <meta name="robots" content="noindex" />
      <link rel="shortcut icon" href="/assets/trashboard-icon-sm.png" />
      <title>{`${title} · Trashboard`}</title>
      <meta name="htmx-config" content='{"historyCacheSize":0}' />
      <link rel="stylesheet" href="/assets/styles.css" />
      <script src="/assets/htmx-2.0.11.min.js" defer />
      <script src="/assets/omnibar.js" defer />
      <script type="module" dangerouslySetInnerHTML={{ __html: SCRIPT }} />
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans:ital,wght@0,100..900;1,100..900&family=Nunito:ital,wght@0,200..1000;1,200..1000&family=Quicksand:wght@300..700&display=swap" rel="stylesheet" />
    </head>
    <body hx-boost="true">
      {path !== null && (
        <nav class="top inline-wrap">
          <div class="brand inline-zero"><img src="/assets/trashboard-icon-sm.png" alt="" /> Trashboard</div>
          {NAV.map((link) => (
            <a href={link.href} class={path === link.href ? 'on' : ''} aria-current={path === link.href ? 'page' : undefined}>
              {link.label}
            </a>
          ))}
          <details class="menu">
            <summary aria-label="Settings" title="Settings">
              <MenuIcon />
            </summary>
            <div class="items stack-zero">
              {menu}
              <button type="button" onclick="document.getElementById('intro').showModal()">Show welcome</button>
              <a href="/sources">Sources</a>
              <a href="/logout">Log out</a>
            </div>
          </details>
        </nav>
      )}
      <main class="page stack">{children}</main>
      {path !== null && <Intro />}
    </body>
  </html>
);
