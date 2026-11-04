import { loadConfig } from '../src/config';

/** Test config: real Postgres (DATABASE_URL_TEST), cheap argon2, no login rate limit. */
export function testConfig() {
  const base = loadConfig({ NODE_ENV: 'test' });
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: base.DATABASE_URL_TEST ?? base.DATABASE_URL,
    RATE_LIMIT_LOGIN_PER_MIN: '100000',
    RATE_LIMIT_GLOBAL_PER_MIN: '100000',
    ARGON2_MEMORY_KIB: '1024',
    ARGON2_TIME_COST: '1',
    MFA_REQUIRED: 'false',
    LOG_LEVEL: 'silent',
    CORS_ORIGINS: '',
    APP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  });
}
