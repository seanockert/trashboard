import { defineConfig } from 'vitest/config';

// Node, not Workers runtime. D1 tests use node:sqlite (test/d1.ts).
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });
