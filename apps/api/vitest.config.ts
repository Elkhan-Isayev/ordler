import { fileURLToPath } from 'node:url';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC emits decorator metadata, which Nest dependency injection relies on.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  resolve: {
    alias: {
      '@ordler/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    // Database tests boot PostgreSQL (PGlite/WASM); shared CI runners can be several times slower.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Every worker holds its own in-memory PostgreSQL; too many at once exhaust memory and stall.
    maxWorkers: 4,
  },
});
