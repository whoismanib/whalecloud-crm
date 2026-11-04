import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    globalSetup: ['./test/globalSetup.ts'],
    // one Postgres database for the run; files run sequentially (audit hash chain lock)
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
