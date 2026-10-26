import { defineConfig } from 'vitest/config';
// Sample runs load DuckDB and H-MEM per runtime; slower machines need more than the 5 s default.
export default defineConfig({ test: { include: ['tests/**/*.test.ts'], testTimeout: 120000 } });
