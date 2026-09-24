// Deletes every table in the remote database, then applies the migrations
// again. Use it only before launch, because it deletes all data.
import { execFileSync } from 'node:child_process';

const DB = 'trashboard';

const wrangler = (args) => execFileSync('npx', ['wrangler', ...args], { encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] });

const [{ results: tables }] = JSON.parse(
  wrangler(['d1', 'execute', DB, '--remote', '--json', '--command', "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'"]),
);

// A virtual table drops its own shadow tables, for example items_fts_data.
const virtual = tables.filter((t) => /^CREATE VIRTUAL TABLE/i.test(t.sql ?? ''));
const isShadow = (name) => virtual.some((v) => name.startsWith(`${v.name}_`));
const drops = [...virtual, ...tables.filter((t) => !virtual.includes(t) && !isShadow(t.name))];

if (drops.length > 0) {
  const sql = ['PRAGMA defer_foreign_keys = true;', ...drops.map((t) => `DROP TABLE IF EXISTS "${t.name}";`)].join(' ');
  wrangler(['d1', 'execute', DB, '--remote', '--command', sql]);
}
execFileSync('npx', ['wrangler', 'd1', 'migrations', 'apply', DB, '--remote'], { stdio: 'inherit' });
