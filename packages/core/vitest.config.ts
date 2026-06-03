import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 10000,
    pool: 'forks',
    forks: { singleFork: true },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: { lines: 75, functions: 75 },
      exclude: ['tests/**', 'dist/**', '**/*.d.ts'],
    },
  },
});
