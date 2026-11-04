import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const PROD = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://x@localhost/db',
  APP_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  COOKIE_SECURE: 'true',
};

describe('config: MFA (QA-007, ADM-01)', () => {
  it('requires MFA by default in production', () => {
    expect(loadConfig({ ...PROD, MFA_REQUIRED: '' }).MFA_REQUIRED).toBe(true);
    expect(loadConfig({ ...PROD, MFA_REQUIRED: 'true' }).MFA_REQUIRED).toBe(true);
  });
  it('rejects MFA_REQUIRED=false in production', () => {
    expect(() => loadConfig({ ...PROD, MFA_REQUIRED: 'false' })).toThrow(/MFA_REQUIRED/);
  });
  it('keeps the development override and defaults to optional outside production', () => {
    const dev = { NODE_ENV: 'development', DATABASE_URL: 'postgres://x@localhost/db' };
    expect(loadConfig({ ...dev, MFA_REQUIRED: 'false' }).MFA_REQUIRED).toBe(false);
    expect(loadConfig({ ...dev, MFA_REQUIRED: '' }).MFA_REQUIRED).toBe(false);
    expect(loadConfig({ ...dev, MFA_REQUIRED: 'true' }).MFA_REQUIRED).toBe(true);
  });
});
