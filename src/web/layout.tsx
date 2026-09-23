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
.top .brand { font-weight: 700; font-size: 20px; margin-right: auto; }
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
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 18px 22px; margin-bottom: 14px; }
.card .meta { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 15px; color: var(--muted); }
.card .title { display: block; font-size: 21px; font-weight: 650; line-height: 1.3; color: var(--text); text-decoration: none; margin: 6px 0 8px; }
.card .title:hover { color: var(--accent); text-decoration: underline; }
.card .body { font-size: 16px; color: var(--muted); white-space: pre-line; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; }
.tags { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.tag { font-size: 14px; padding: 2px 10px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); }
.tag.warn { background: var(--warn-soft); color: var(--warn); }
.bar { height: 8px; width: 96px; background: var(--line); border-radius: 3px; overflow: hidden; align-self: center; }
.bar > div { height: 100%; background: var(--accent); }
table { width: 100%; border-collapse: collapse; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; margin-bottom: 16px; }
th, td { text-align: left; padding: 10px 14px; border-bottom: 1px solid var(--line); font-size: 16px; }
th { color: var(--muted); font-weight: 600; font-size: 14px; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
tr.self td { font-weight: 650; }
.scroll { overflow-x: auto; }
.empty { color: var(--muted); padding: 24px; text-align: center; background: var(--panel); border: 1px dashed var(--line); border-radius: 8px; }
.note { font-size: 15px; color: var(--muted); }
.login { max-width: 340px; margin: 12vh auto; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 24px; display: flex; flex-direction: column; gap: 12px; }
.error { color: var(--bad); }
.pager { display: flex; justify-content: space-between; align-items: center; margin-top: 16px; }
`;

const NAV = [
  { href: '/changes', label: 'Regulatory changes' },
  { href: '/enforcement', label: 'Enforcement' },
  { href: '/search', label: 'Search' },
  { href: '/sources', label: 'Sources' },
] as const;

export const Layout = ({ title, path, children }: { title: string; path: string | null; children: Child }) => (
  <html lang="en-AU">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="robots" content="noindex" />
      <title>{`${title} · Trashboard`}</title>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
    </head>
    <body>
      {path !== null && (
        <nav class="top">
          <div class="brand">Trashboard</div>
          {NAV.map((link) => (
            <a href={link.href} class={path.startsWith(link.href) ? 'on' : ''}>
              {link.label}
            </a>
          ))}
          <a href="/logout">Log out</a>
        </nav>
      )}
      <main class="page">{children}</main>
    </body>
  </html>
);

export const Bar = ({ value }: { value: number }) => (
  <div class="bar" title={value.toFixed(2)}>
    <div style={`width:${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`} />
  </div>
);
