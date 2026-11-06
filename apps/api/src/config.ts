import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

// Load the repo-root .env in dev/test (docker passes env vars directly).
for (const p of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
  if (existsSync(p)) {
    process.loadEnvFile(p);
    break;
  }
}

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const ConfigSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_ENV: z.string().default('dev'),
    LOG_LEVEL: z.string().default('info'),
    APP_TIMEZONE: z.string().default('America/Santiago'),
    API_HOST: z.string().default('0.0.0.0'),
    API_PORT: z.coerce.number().int().default(3000),
    TRUST_PROXY: bool,
    CORS_ORIGINS: z.string().optional().default(''),
    DATABASE_URL: z.string().min(1),
    DATABASE_URL_MIGRATIONS: z.string().optional(),
    DATABASE_URL_TEST: z.string().optional(),
    DB_POOL_MAX: z.coerce.number().int().default(10),
    DB_SSL: bool,
    APP_ENCRYPTION_KEY: z.string().optional().default(''),
    /** ADM-01: unset → true in production, false elsewhere; production rejects `false`. */
    MFA_REQUIRED: z
      .string()
      .optional()
      .transform((v) => (v === undefined || v === '' ? undefined : v === 'true' || v === '1')),
    SESSION_COOKIE_NAME: z.string().default('wc_sid'),
    SESSION_IDLE_HOURS: z.coerce.number().default(12),
    SESSION_ABSOLUTE_DAYS: z.coerce.number().default(7),
    COOKIE_SECURE: bool,
    RATE_LIMIT_GLOBAL_PER_MIN: z.coerce.number().int().default(300),
    RATE_LIMIT_LOGIN_PER_MIN: z.coerce.number().int().default(5),
    LOGIN_MAX_FAILED: z.coerce.number().int().default(10),
    LOGIN_LOCK_MINUTES: z.coerce.number().int().default(15),
    ARGON2_MEMORY_KIB: z.coerce.number().int().default(19456),
    ARGON2_TIME_COST: z.coerce.number().int().default(2),
    MAIL_DRIVER: z.enum(['console', 'none']).default('console'),
    /**
     * eDo Open API (read-only incident sync, ADR 0007). The token is never stored in the DB or
     * logged; pass it in the environment, e.g. from the macOS Keychain when starting compose.
     */
    EDO_ACCESS_TOKEN: z.string().optional(),
    EDO_BASE_URL: z.string().url().default('https://edo.iwhalecloud.com'),
    EDO_PROJECT_ID: z.string().default('PMP202007281519402'),
    EDO_ISSUE_TYPE: z.string().default('10001'),
    /** Account that owns the synced tickets. */
    EDO_ACCOUNT_NAME: z.string().default('WOM'),
    /** Tests/demo: path of a raw eDo response (list of items) used instead of the network. */
    EDO_FIXTURE: z.string().optional(),
    /** Unset = enabled; `false` keeps the worker process idle (e.g. a second replica). */
    WORKER_ENABLED: z
      .string()
      .optional()
      .transform((v) => v === undefined || v === '' || v === 'true' || v === '1'),
    SEED_ADMIN_EMAIL: z.string().default('admin@example.com'),
    SEED_ADMIN_PASSWORD: z.string().default('change-me-admin-123'),
    SEED_DEMO_PASSWORD: z.string().default('Demo-Password-2026!'),
  })
  .superRefine((c, ctx) => {
    if (c.NODE_ENV !== 'production') return;
    if (Buffer.from(c.APP_ENCRYPTION_KEY, 'base64').length !== 32) {
      ctx.addIssue({
        code: 'custom',
        path: ['APP_ENCRYPTION_KEY'],
        message: 'required (32 bytes)',
      });
    }
    if (!c.COOKIE_SECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['COOKIE_SECURE'],
        message: 'must be true in production',
      });
    }
    if (c.MFA_REQUIRED === false) {
      ctx.addIssue({
        code: 'custom',
        path: ['MFA_REQUIRED'],
        message: 'must be true in production (ADM-01)',
      });
    }
  })
  .transform((c) => ({ ...c, MFA_REQUIRED: c.MFA_REQUIRED ?? c.NODE_ENV === 'production' }));

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(overrides: Partial<Record<string, string>> = {}): Config {
  return ConfigSchema.parse({ ...process.env, ...overrides });
}
