import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/**
 * E2E (CONVENTIONS §6): API (tsx) against a freshly seeded `wcrm_e2e` database + `vite preview`
 * of the production build. `npm run test:e2e` from the repo root.
 *
 * Env: E2E_API_PORT (3100), E2E_WEB_PORT (4180), E2E_DB_NAME (wcrm_e2e), E2E_SKIP_DB_RESET,
 * PW_CHROMIUM_PATH (defaults to the preinstalled /opt/pw-browsers/chromium when present).
 */
const apiPort = process.env.E2E_API_PORT ?? '3100';
const webPort = process.env.E2E_WEB_PORT ?? '4180';
const chromium =
  process.env.PW_CHROMIUM_PATH ??
  (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

export default defineConfig({
  testDir: './e2e',
  // Specs share one seeded database and some mutate it: run serially for determinism.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    locale: 'es-CL',
    timezoneId: 'America/Santiago',
    actionTimeout: 15_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: chromium ? { executablePath: chromium } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], deviceScaleFactor: 1 } }],
  webServer: [
    {
      command: 'node e2e/support/start-api.mjs',
      url: `http://127.0.0.1:${apiPort}/readyz`,
      timeout: 240_000,
      reuseExistingServer: !process.env.CI,
      env: { E2E_API_PORT: apiPort },
      stdout: 'pipe',
    },
    {
      command: `npx vite build && npx vite preview --host 127.0.0.1 --port ${webPort} --strictPort`,
      url: `http://127.0.0.1:${webPort}`,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      env: { VITE_API_PROXY: `http://127.0.0.1:${apiPort}` },
    },
  ],
});
