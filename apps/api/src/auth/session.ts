import type { UserRole } from '@wcrm/shared';
import { and, eq, gt } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config';
import type { Db } from '../db/client';
import { sessions, userRoles, users } from '../db/schema/index';
import type { AuthInfo } from '../types';
import { randomToken, sha256 } from './crypto';

export const CSRF_COOKIE = 'wc_csrf';

export async function createSession(
  db: Db,
  config: Config,
  userId: string,
  mfaVerified: boolean,
  req: FastifyRequest,
): Promise<{ token: string; csrf: string }> {
  const token = randomToken();
  const csrf = randomToken(16);
  await db.insert(sessions).values({
    userId,
    tokenHash: sha256(token),
    csrfToken: csrf,
    mfaVerified,
    expiresAt: new Date(Date.now() + config.SESSION_ABSOLUTE_DAYS * 86_400_000),
    ip: req.ip,
    userAgent: req.headers['user-agent']?.slice(0, 500) ?? null,
  });
  return { token, csrf };
}

export function setSessionCookies(
  reply: FastifyReply,
  config: Config,
  token: string,
  csrf: string,
): void {
  const common = { path: '/', sameSite: 'lax' as const, secure: config.COOKIE_SECURE };
  reply.setCookie(config.SESSION_COOKIE_NAME, token, { ...common, httpOnly: true });
  reply.setCookie(CSRF_COOKIE, csrf, { ...common, httpOnly: false });
}

export function clearSessionCookies(reply: FastifyReply, config: Config): void {
  reply.clearCookie(config.SESSION_COOKIE_NAME, { path: '/' });
  reply.clearCookie(CSRF_COOKIE, { path: '/' });
}

/** Resolves the session cookie (idle 12 h, absolute 7 d) to user + roles. */
export async function loadSession(db: Db, config: Config, token: string): Promise<AuthInfo | null> {
  const now = new Date();
  const rows = await db
    .select({ s: sessions, u: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, now)))
    .limit(1);
  const row = rows[0];
  if (!row || !row.u.isActive) return null;
  const idleMs = config.SESSION_IDLE_HOURS * 3_600_000;
  if (now.getTime() - row.s.lastSeenAt.getTime() > idleMs) {
    await db.delete(sessions).where(eq(sessions.id, row.s.id));
    return null;
  }
  if (now.getTime() - row.s.lastSeenAt.getTime() > 60_000) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.s.id));
  }
  const roles = await db
    .select({ role: userRoles.role })
    .from(userRoles)
    .where(eq(userRoles.userId, row.u.id));
  return {
    sessionId: row.s.id,
    csrfToken: row.s.csrfToken,
    mfaVerified: row.s.mfaVerified,
    user: {
      id: row.u.id,
      email: row.u.email,
      fullName: row.u.fullName,
      locale: row.u.locale,
      timezone: row.u.timezone,
      calendarId: row.u.calendarId,
      countryCodes: row.u.countryCodes,
      mfaEnabled: row.u.mfaEnabled,
    },
    roles: roles.map((r) => r.role as UserRole),
  };
}
