// Node types for tests. Project types target Workers.
declare module 'node:sqlite' {
  type Value = null | number | bigint | string | Uint8Array;
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): { all(...params: Value[]): unknown[]; get(...params: Value[]): unknown };
  }
}

declare module 'node:fs' {
  export const readFileSync: (path: string, encoding: 'utf8') => string;
  export const readdirSync: (path: string) => string[];
}
