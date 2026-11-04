import {
  LoginSchema,
  MfaVerifySchema,
  PreferencesSchema,
  lettersFor,
  PROCESS_CODES,
  ACTION_ROLES,
  visibleStages,
} from '@wcrm/shared';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { authenticator } from 'otplib';
import { recordAudit } from '../../audit/record';
import { decrypt, encrypt, verifyPassword } from '../../auth/crypto';
import { clearSessionCookies, createSession, setSessionCookies } from '../../auth/session';
import { sessions, userRoles, users } from '../../db/schema/index';
import { AppError } from '../../lib/errors';
import { actorOf, authOf, ok } from '../../lib/http';
import { parse } from '../../lib/validate';
import { delegatedFor } from '../../services/delegations';

export async function authRoutes(app: FastifyInstance) {
  const { db, config, rules } = app.ctx;

  app.post(
    '/auth/login',
    {
      config: {
        public: true,
        rateLimit: { max: config.RATE_LIMIT_LOGIN_PER_MIN, timeWindow: '1 minute' },
      },
    },
    async (req, reply) => {
      const body = parse(LoginSchema, req.body);
      const [user] = await db.select().from(users).where(eq(users.email, body.email)).limit(1);
      const now = new Date();
      if (user?.lockedUntil && user.lockedUntil > now) throw new AppError(423, 'ACCOUNT_LOCKED');
      const valid =
        user && user.isActive && (await verifyPassword(user.passwordHash, body.password));
      if (!user || !valid) {
        if (user) {
          const failed = user.failedLogins + 1;
          const lock = failed >= config.LOGIN_MAX_FAILED;
          await db
            .update(users)
            .set({
              failedLogins: lock ? 0 : failed,
              lockedUntil: lock
                ? new Date(now.getTime() + config.LOGIN_LOCK_MINUTES * 60_000)
                : null,
            })
            .where(eq(users.id, user.id));
          await recordAudit(
            db,
            { ...actorOf(req), userId: user.id },
            {
              action: 'LOGIN_FAILED',
              category: 'SECURITY',
              entityType: 'user',
              entityId: user.id,
            },
          );
        }
        throw new AppError(401, 'INVALID_CREDENTIALS');
      }
      const mfaRequired = user.mfaEnabled || config.MFA_REQUIRED;
      const { token, csrf } = await createSession(db, config, user.id, !mfaRequired, req);
      await db
        .update(users)
        .set({ failedLogins: 0, lockedUntil: null, lastLoginAt: now })
        .where(eq(users.id, user.id));
      const roles = await db
        .select({ role: userRoles.role })
        .from(userRoles)
        .where(eq(userRoles.userId, user.id));
      await recordAudit(
        db,
        { ...actorOf(req), userId: user.id, roles: roles.map((r) => r.role) },
        {
          action: 'LOGIN',
          category: 'SECURITY',
          entityType: 'user',
          entityId: user.id,
          changes: [{ field: 'mfaPending', old: null, new: mfaRequired }],
        },
      );
      setSessionCookies(reply, config, token, csrf);
      return ok({ mfaRequired, enrolled: user.mfaEnabled, csrfToken: csrf });
    },
  );

  // MFA (TOTP RFC 6238). Mandatory when MFA_REQUIRED=true (ADM-01); optional per user in dev.
  app.post('/auth/mfa/setup', { config: { allowPartialSession: true } }, async (req) => {
    const auth = authOf(req);
    if (auth.user.mfaEnabled) throw new AppError(409, 'MFA_ALREADY_ENROLLED');
    if (!config.APP_ENCRYPTION_KEY) throw new AppError(500, 'ENCRYPTION_KEY_MISSING');
    const secret = authenticator.generateSecret();
    await db
      .update(users)
      .set({ mfaSecretEnc: encrypt(secret, config.APP_ENCRYPTION_KEY) })
      .where(eq(users.id, auth.user.id));
    return ok({
      secretBase32: secret,
      otpauthUri: authenticator.keyuri(auth.user.email, 'CRM WhaleCloud LatAm', secret),
    });
  });

  app.post('/auth/mfa/verify', { config: { allowPartialSession: true } }, async (req) => {
    const auth = authOf(req);
    const { code } = parse(MfaVerifySchema, req.body);
    const [user] = await db.select().from(users).where(eq(users.id, auth.user.id));
    if (!user?.mfaSecretEnc) throw new AppError(409, 'MFA_NOT_SETUP');
    const secret = decrypt(user.mfaSecretEnc, config.APP_ENCRYPTION_KEY);
    if (!authenticator.check(code, secret)) throw new AppError(401, 'MFA_INVALID');
    await db.update(sessions).set({ mfaVerified: true }).where(eq(sessions.id, auth.sessionId));
    if (!user.mfaEnabled) {
      await db.update(users).set({ mfaEnabled: true }).where(eq(users.id, user.id));
      await recordAudit(db, actorOf(req), {
        action: 'MFA_ENROLL',
        category: 'SECURITY',
        entityType: 'user',
        entityId: user.id,
      });
    }
    return ok({ mfaVerified: true });
  });

  app.post('/auth/logout', { config: { allowPartialSession: true } }, async (req, reply) => {
    const auth = authOf(req);
    await db.delete(sessions).where(eq(sessions.id, auth.sessionId));
    await recordAudit(db, actorOf(req), {
      action: 'LOGOUT',
      category: 'SECURITY',
      entityType: 'user',
      entityId: auth.user.id,
    });
    clearSessionCookies(reply, config);
    return ok({ loggedOut: true });
  });

  app.get('/auth/me', { config: { allowPartialSession: true } }, async (req) => {
    const auth = authOf(req);
    const { raci } = await rules.get();
    const permissions = Object.fromEntries(
      PROCESS_CODES.map((p) => [p, lettersFor(auth.roles, p, raci)]),
    );
    const actionRoles = Object.fromEntries(
      Object.entries(ACTION_ROLES).map(([k, roles]) => [
        k,
        (roles as readonly string[]).some((r) => auth.roles.includes(r as never)),
      ]),
    );
    return ok({
      ...auth.user,
      roles: auth.roles,
      mfaVerified: auth.mfaVerified,
      csrfToken: auth.csrfToken,
      permissions,
      actionRoles,
      visibleStages: visibleStages(auth.roles, raci),
      delegatedRoles: (await delegatedFor(db, auth.user.id, req.today)).roles,
    });
  });

  app.patch('/me/preferences', { config: { session: true } }, async (req) => {
    const auth = authOf(req);
    const body = parse(PreferencesSchema, req.body);
    await db
      .update(users)
      .set({ ...body, updatedAt: sql`now()`, updatedBy: auth.user.id })
      .where(eq(users.id, auth.user.id));
    return ok(body);
  });
}
