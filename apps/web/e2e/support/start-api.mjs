// E2E API launcher (used by playwright.config.ts `webServer`).
// 1. Recreates a dedicated database (default `wcrm_e2e`) next to the dev database, so the e2e run
//    never touches `wcrm` (dev) or `wcrm_test` (API integration tests).
// 2. Applies the migrations and the base + demo seed (`--demo`, dates anchored to "today").
// 3. Starts the API (tsx, no build needed) with relaxed rate limits on E2E_API_PORT.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const apiDir = resolve(root, 'apps/api');
if (existsSync(resolve(root, '.env'))) process.loadEnvFile(resolve(root, '.env'));

const dbName = process.env.E2E_DB_NAME ?? 'wcrm_e2e';
const port = process.env.E2E_API_PORT ?? '3100';
const ownerUrl = new URL(
  process.env.DATABASE_URL_MIGRATIONS ??
    'postgres://wcrm_owner:change-me-owner@localhost:5432/wcrm',
);
const appUrl = new URL(
  process.env.DATABASE_URL ?? 'postgres://wcrm_app:change-me-app@localhost:5432/wcrm',
);
const appUser = decodeURIComponent(appUrl.username);
const withDb = (u, db) => {
  const c = new URL(u.href);
  c.pathname = `/${db}`;
  return c.href;
};

async function recreateDatabase() {
  const admin = new pg.Client({ connectionString: withDb(ownerUrl, 'postgres') });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin.query(`CREATE DATABASE ${dbName}`);
  } finally {
    await admin.end();
  }
  const owner = new pg.Client({ connectionString: withDb(ownerUrl, dbName) });
  await owner.connect();
  try {
    // Same grants as docker/postgres/init/01-roles.sh (owner = migrations, app = runtime).
    await owner.query(`
      GRANT CONNECT ON DATABASE ${dbName} TO ${appUser};
      GRANT USAGE ON SCHEMA public TO ${appUser};
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${appUser};
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${appUser};
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO ${appUser};
    `);
  } finally {
    await owner.end();
  }
}

const env = {
  ...process.env,
  NODE_ENV: 'development',
  DATABASE_URL: withDb(appUrl, dbName),
  DATABASE_URL_MIGRATIONS: withDb(ownerUrl, dbName),
  API_PORT: port,
  API_HOST: '127.0.0.1',
  CORS_ORIGINS: '',
  MFA_REQUIRED: 'false',
  MAIL_DRIVER: 'none',
  WORKER_ENABLED: 'false',
  LOG_LEVEL: process.env.E2E_LOG_LEVEL ?? 'warn',
  // Every spec logs in from 127.0.0.1: keep the login limiter out of the way.
  RATE_LIMIT_LOGIN_PER_MIN: '1000',
  RATE_LIMIT_GLOBAL_PER_MIN: '100000',
};

const tsx = (script, args = []) =>
  spawnSync(process.execPath, ['--import', 'tsx', script, ...args], {
    cwd: apiDir,
    env,
    stdio: 'inherit',
  });

if (process.env.E2E_SKIP_DB_RESET !== 'true') {
  await recreateDatabase();
  for (const [script, args] of [
    ['src/migrate.ts', []],
    ['src/db/seed/seed.ts', ['--demo']],
  ]) {
    const r = tsx(script, args);
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
}

const server = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
  cwd: apiDir,
  env,
  stdio: 'inherit',
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.kill(sig));
server.on('exit', (code) => process.exit(code ?? 0));
