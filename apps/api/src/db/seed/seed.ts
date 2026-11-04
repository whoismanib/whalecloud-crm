import { buildApp } from '../../app';
import { loadConfig } from '../../config';
import { dateInTz } from '../../lib/dates';
import { createDb } from '../client';
import { seedBase } from './base';
import { seedDemo } from './demo';

/**
 * `npm run db:seed` → base data (idempotent). `npm run db:seed -- --demo` adds demo users and
 * records from the source document. Runs with the owner role (DATABASE_URL_MIGRATIONS).
 */
const demo = process.argv.includes('--demo');
const base = loadConfig();
const url = base.DATABASE_URL_MIGRATIONS ?? base.DATABASE_URL;
const config = loadConfig({
  DATABASE_URL: url,
  RATE_LIMIT_LOGIN_PER_MIN: '100000',
  RATE_LIMIT_GLOBAL_PER_MIN: '100000',
  // demo data is loaded through the API without TOTP; never relaxed in production (ADM-01)
  ...(base.NODE_ENV === 'production' ? {} : { MFA_REQUIRED: 'false' }),
  LOG_LEVEL: 'warn',
});
const { db, pool } = createDb(url, { max: 2 });
try {
  await seedBase(db, config);
  console.log('base seed applied');
  if (demo) {
    if (config.NODE_ENV === 'production') throw new Error('--demo is not allowed in production');
    const app = await buildApp({
      config,
      databaseUrl: url,
      logger: false,
      allowTodayOverride: true,
    });
    await app.ready();
    try {
      await seedDemo(app, db, config, dateInTz(new Date(), config.APP_TIMEZONE));
    } finally {
      await app.close();
    }
  }
} finally {
  await pool.end();
}
