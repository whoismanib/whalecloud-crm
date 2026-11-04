import type { FastifyInstance } from 'fastify';
import { authenticator } from 'otplib';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, client, createTestApp, createUser, login, PASSWORD } from '../../../test/helpers';

let app: FastifyInstance;
beforeAll(async () => {
  app = await createTestApp();
});
afterAll(async () => {
  await app.close();
});

describe('auth (ADM-01)', () => {
  it('logs in with argon2id password and sets httpOnly session + CSRF cookies', async () => {
    const u = await createUser(app, ['ACCOUNT_MANAGER']);
    const res = await request(app.server)
      .post('/api/v1/auth/login')
      .send({ email: u.email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ mfaRequired: false, enrolled: false });
    const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    expect(cookies.find((c) => c.startsWith('wc_sid='))).toMatch(/HttpOnly/i);
    expect(cookies.find((c) => c.startsWith('wc_csrf='))).not.toMatch(/HttpOnly/i);
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('rejects wrong password with 401 and writes LOGIN_FAILED to the audit log', async () => {
    const u = await createUser(app, ['ACCOUNT_MANAGER']);
    const res = await request(app.server)
      .post('/api/v1/auth/login')
      .send({ email: u.email, password: 'nope-nope-nope' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_CREDENTIALS');
    expect(res.headers['content-type']).toMatch(/problem\+json/);
    const r = await app.ctx.pool.query(
      `SELECT count(*)::int n FROM audit_log WHERE action = 'LOGIN_FAILED' AND entity_id = $1`,
      [u.id],
    );
    expect(r.rows[0].n).toBe(1);
  });

  it('locks the account after LOGIN_MAX_FAILED attempts (423)', async () => {
    const u = await createUser(app, ['ACCOUNT_MANAGER']);
    for (let i = 0; i < app.ctx.config.LOGIN_MAX_FAILED; i++) {
      await request(app.server)
        .post('/api/v1/auth/login')
        .send({ email: u.email, password: 'bad-password-x' });
    }
    const res = await request(app.server)
      .post('/api/v1/auth/login')
      .send({ email: u.email, password: PASSWORD });
    expect(res.status).toBe(423);
    expect(res.body.code).toBe('ACCOUNT_LOCKED');
  });

  it('GET /auth/me returns roles and RACI-derived permissions; 401 without session', async () => {
    const s = await as(app, ['VP']);
    const me = await client(app, s).get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.data.roles).toEqual(['VP']);
    expect(me.body.data.permissions.P6).toEqual(['A']);
    expect(me.body.data.permissions.P5).toEqual(['I']);
    expect((await request(app.server).get('/api/v1/auth/me')).status).toBe(401);
  });

  it('requires X-CSRF-Token on unsafe methods (403 CSRF_INVALID)', async () => {
    const s = await as(app, ['ACCOUNT_MANAGER']);
    const res = await request(app.server).post('/api/v1/tickets').set('Cookie', s.cookie).send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CSRF_INVALID');
  });

  it('logout deletes the session', async () => {
    const s = await as(app, ['ACCOUNT_MANAGER']);
    expect((await client(app, s).post('/auth/logout')).status).toBe(200);
    expect((await client(app, s).get('/auth/me')).status).toBe(401);
  });

  it('TOTP MFA: enrol, partial session until verified, then full access', async () => {
    const u = await createUser(app, ['COUNTRY_MANAGER']);
    const s1 = await login(app, u.email);
    const setup = await client(app, s1).post('/auth/mfa/setup');
    expect(setup.status).toBe(200);
    expect(setup.body.data.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
    const bad = await client(app, s1).post('/auth/mfa/verify', { code: '000000' });
    expect(bad.status).toBe(401);
    const ok = await client(app, s1).post('/auth/mfa/verify', {
      code: authenticator.generate(setup.body.data.secretBase32),
    });
    expect(ok.status).toBe(200);
    // next login requires MFA: business routes answer 401 MFA_REQUIRED until verified
    const s2 = await login(app, u.email);
    const blocked = await client(app, s2).get('/accounts');
    expect(blocked.status).toBe(401);
    expect(blocked.body.code).toBe('MFA_REQUIRED');
    const me = await client(app, s2).get('/auth/me');
    expect(me.body.data.mfaVerified).toBe(false);
  });

  it('healthz is public', async () => {
    expect((await request(app.server).get('/healthz')).body).toEqual({ ok: true });
  });
});
