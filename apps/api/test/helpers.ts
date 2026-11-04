import type { UserRole } from '@wcrm/shared';
import type { FastifyInstance } from 'fastify';
import request from 'supertest';
import { buildApp } from '../src/app';
import { upsertUser } from '../src/db/seed/base';
import { testConfig } from './config';

export const PASSWORD = 'Test-Password-2026!';
export const TODAY = '2026-11-04';

export async function createTestApp(): Promise<FastifyInstance> {
  const config = testConfig();
  const app = await buildApp({ config, logger: false, allowTodayOverride: true });
  await app.ready();
  return app;
}

let seq = 0;
export function uniq(prefix = 'x'): string {
  seq++;
  return `${prefix}${Date.now().toString(36)}${seq}`;
}

export interface Session {
  cookie: string;
  csrf: string;
  userId: string;
  email: string;
}

export async function createUser(
  app: FastifyInstance,
  roles: UserRole[],
  opts: { countryCodes?: string[]; calendarId?: string } = {},
): Promise<{ id: string; email: string }> {
  const email = `${uniq(roles[0]!.toLowerCase())}@test.local`;
  const id = await upsertUser(app.ctx.db, app.ctx.config, {
    email,
    fullName: `Test ${roles.join('+')}`,
    password: PASSWORD,
    roles,
    countryCodes: opts.countryCodes ?? ['CL'],
    calendarId: opts.calendarId,
  });
  return { id, email };
}

export async function login(
  app: FastifyInstance,
  email: string,
  password = PASSWORD,
): Promise<Session> {
  const res = await request(app.server).post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed ${res.status} ${JSON.stringify(res.body)}`);
  const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const cookie = cookies.map((c) => c.split(';')[0]).join('; ');
  return { cookie, csrf: res.body.data.csrfToken, userId: '', email };
}

export async function as(
  app: FastifyInstance,
  roles: UserRole[],
  opts: { countryCodes?: string[] } = {},
) {
  const u = await createUser(app, roles, opts);
  const s = await login(app, u.email);
  return { ...s, userId: u.id };
}

/** Supertest client bound to a session (cookie + CSRF + fixed "today"). */
export function client(app: FastifyInstance, s: Session, today = TODAY) {
  const wrap = (r: request.Test) =>
    r.set('Cookie', s.cookie).set('X-CSRF-Token', s.csrf).set('X-Test-Today', today);
  return {
    get: (url: string) => wrap(request(app.server).get(`/api/v1${url}`)),
    post: (url: string, body?: object) =>
      wrap(request(app.server).post(`/api/v1${url}`)).send(body ?? {}),
    put: (url: string, body?: object) =>
      wrap(request(app.server).put(`/api/v1${url}`)).send(body ?? {}),
    patch: (url: string, body?: object) =>
      wrap(request(app.server).patch(`/api/v1${url}`)).send(body ?? {}),
    delete: (url: string) => wrap(request(app.server).delete(`/api/v1${url}`)),
  };
}
