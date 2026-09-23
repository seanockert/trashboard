import { defineConfig } from 'vitest/config';

// The tests cover pure functions, thus they run in Node, not in the Workers runtime.
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });
