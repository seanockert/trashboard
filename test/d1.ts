import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

type Value = null | number | string;

// In-memory D1 with migrations. Only the calls src/db.ts uses.
export const testDb = () => {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync('migrations').sort()) sqlite.exec(readFileSync(`migrations/${file}`, 'utf8'));
  const statement = (sql: string, params: Value[] = []) => ({
    bind: (...values: Value[]) => statement(sql, values),
    all: async () => ({ results: sqlite.prepare(sql).all(...params), success: true, meta: {} }),
    first: async () => sqlite.prepare(sql).get(...params) ?? null,
    run: async () => ({ results: sqlite.prepare(sql).all(...params), success: true, meta: {} }),
  });
  const batch = async (statements: ReturnType<typeof statement>[]) => {
    sqlite.exec('BEGIN');
    try {
      const results = await Promise.all(statements.map((s) => s.all()));
      sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    }
  };
  const db = { prepare: (sql: string) => statement(sql), batch } as unknown as D1Database;
  const rows = (sql: string, ...params: Value[]) => sqlite.prepare(sql).all(...params) as Record<string, unknown>[];
  return { db, rows };
};
