import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { can, hasActionRole } from '@wcrm/shared';
import Fastify, { type FastifyInstance } from 'fastify';
import { loadConfig, type Config } from './config';
import { createDb } from './db/client';
import { loadSession } from './auth/session';
import { AppError } from './lib/errors';
import { dateInTz } from './lib/dates';
import { createMailer } from './services/mailer';
import { RulesContextService } from './services/rulesContext';
import type { AppContext } from './types';
import { authRoutes } from './modules/auth/routes';
import { catalogRoutes } from './modules/catalogs/routes';
import { accountRoutes } from './modules/accounts/routes';
import { opportunityRoutes } from './modules/opportunities/routes';
import { priceRequestRoutes } from './modules/price-requests/routes';
import { approvalRoutes } from './modules/approvals/routes';
import { contractRoutes } from './modules/contracts/routes';
import { billingRoutes } from './modules/milestones/routes';
import { ticketRoutes } from './modules/tickets/routes';
import { dashboardRoutes } from './modules/dashboard/routes';
import { auditRoutes } from './modules/audit/routes';
import { postsaleRoutes } from './modules/accounts/postsale.routes';
import { changeRequestRoutes } from './modules/change-requests/routes';
import { forecastRoutes } from './modules/forecast/routes';
import { distributorRoutes } from './modules/distributors/routes';
import { complianceRoutes } from './modules/compliance/routes';
import { onboardingRoutes } from './modules/onboarding/routes';
import { capacityRoutes } from './modules/capacity/routes';
import { adminRoutes } from './modules/admin/routes';
import { importExportRoutes } from './modules/imports/routes';
import { notificationRoutes } from './modules/notifications/routes';
import './types';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface BuildOptions {
  config?: Config;
  databaseUrl?: string;
  logger?: boolean;
  /** Accept `x-test-today: YYYY-MM-DD` (tests and demo seed only; never in production). */
  allowTodayOverride?: boolean;
}

export async function buildApp(opts: BuildOptions = {}): Promise<FastifyInstance> {
  const config = opts.config ?? loadConfig();
  const { db, pool } = createDb(opts.databaseUrl ?? config.DATABASE_URL, {
    max: config.DB_POOL_MAX,
    ssl: config.DB_SSL,
  });
  const app = Fastify({
    logger:
      opts.logger === false
        ? false
        : {
            level: config.LOG_LEVEL,
            redact: ['req.headers.cookie', 'req.headers.authorization', 'body.password'],
          },
    trustProxy: config.TRUST_PROXY,
    genReqId: (req) => (req.headers['x-request-id'] as string) || crypto.randomUUID(),
    bodyLimit: 1_048_576,
  });

  const allowToday =
    config.NODE_ENV !== 'production' && (opts.allowTodayOverride ?? config.NODE_ENV === 'test');
  const ctx: AppContext = {
    db,
    pool,
    config,
    rules: new RulesContextService(db, config.NODE_ENV === 'test' ? 0 : 60_000),
    mailer: createMailer(config.NODE_ENV === 'test' ? 'none' : config.MAIL_DRIVER),
    routes: [],
  };
  app.decorate('ctx', ctx);
  app.decorateRequest('auth', null);
  app.decorateRequest('today', '');
  app.addHook('onClose', async () => {
    await pool.end();
  });
  app.addHook('onRoute', (r) => {
    if (r.method === 'HEAD' || r.method === 'OPTIONS') return;
    ctx.routes.push({
      method: Array.isArray(r.method) ? r.method.join(',') : String(r.method),
      url: r.url,
      isPublic: Boolean(r.config?.public),
      hasGuard: Boolean(r.config?.guard || r.config?.session || r.config?.allowPartialSession),
    });
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
  });
  await app.register(cookie);
  if (config.CORS_ORIGINS) {
    await app.register(cors, { origin: config.CORS_ORIGINS.split(','), credentials: true });
  }
  await app.register(rateLimit, {
    max: config.RATE_LIMIT_GLOBAL_PER_MIN,
    timeWindow: '1 minute',
    errorResponseBuilder: (_req, c) =>
      new AppError(429, 'RATE_LIMITED', `Retry after ${Math.ceil(c.ttl / 1000)}s`),
  });

  app.addHook('onSend', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  // Authentication, CSRF and RBAC guard for every non-public route (ARCHITECTURE §6).
  app.addHook('preHandler', async (req) => {
    const testToday = req.headers['x-test-today'];
    req.today =
      allowToday && typeof testToday === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(testToday)
        ? testToday
        : dateInTz(new Date(), config.APP_TIMEZONE);
    const cfg = req.routeOptions.config;
    if (!req.routeOptions.url || cfg?.public) return;
    const token = req.cookies[config.SESSION_COOKIE_NAME];
    const auth = token ? await loadSession(db, config, token) : null;
    if (!auth) throw new AppError(401, 'UNAUTHENTICATED');
    if (!auth.mfaVerified && !cfg?.allowPartialSession) throw new AppError(401, 'MFA_REQUIRED');
    if (UNSAFE.has(req.method) && req.headers['x-csrf-token'] !== auth.csrfToken) {
      throw new AppError(403, 'CSRF_INVALID');
    }
    req.auth = auth;
    const guard = cfg?.guard;
    if (guard) {
      const { raci } = await ctx.rules.get();
      if (!can(auth.roles, guard.process, guard.action, raci)) throw new AppError(403, 'FORBIDDEN');
      if (guard.actionRole && !hasActionRole(auth.roles, guard.actionRole)) {
        throw new AppError(403, 'FORBIDDEN');
      }
    }
  });

  app.setErrorHandler((err, req, reply) => {
    const e =
      err instanceof AppError
        ? err
        : (err as { statusCode?: number }).statusCode === 429
          ? new AppError(429, 'RATE_LIMITED')
          : (err as { validation?: unknown }).validation ||
              (err as { code?: string }).code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' ||
              (err as { statusCode?: number }).statusCode === 400
            ? new AppError(400, 'VALIDATION_ERROR', err.message)
            : null;
    if (!e) {
      const pgCode = (err as { code?: string }).code;
      if (pgCode === '23505') {
        return reply
          .status(409)
          .type('application/problem+json')
          .send({ status: 409, code: 'DUPLICATE', title: 'Duplicate', requestId: req.id });
      }
      req.log.error({ err }, 'unhandled error');
      return reply
        .status(500)
        .type('application/problem+json')
        .send({ status: 500, code: 'INTERNAL', title: 'Internal error', requestId: req.id });
    }
    return reply
      .status(e.status)
      .type('application/problem+json')
      .send({
        type: `about:blank#${e.code.toLowerCase()}`,
        title: e.code,
        status: e.status,
        code: e.code,
        detail: e.message,
        requestId: req.id,
        errors: e.errors,
      });
  });
  app.setNotFoundHandler((req, reply) =>
    reply
      .status(404)
      .type('application/problem+json')
      .send({ status: 404, code: 'NOT_FOUND', title: 'Not found', requestId: req.id }),
  );

  app.get('/healthz', { config: { public: true } }, async () => ({ ok: true }));
  app.get('/readyz', { config: { public: true } }, async () => {
    await pool.query('select 1');
    return { ok: true };
  });

  await app.register(
    async (api) => {
      await authRoutes(api);
      await catalogRoutes(api);
      await accountRoutes(api);
      await opportunityRoutes(api);
      await priceRequestRoutes(api);
      await approvalRoutes(api);
      await contractRoutes(api);
      await billingRoutes(api);
      await ticketRoutes(api);
      await dashboardRoutes(api);
      await auditRoutes(api);
      await postsaleRoutes(api);
      await changeRequestRoutes(api);
      await forecastRoutes(api);
      await distributorRoutes(api);
      await complianceRoutes(api);
      await onboardingRoutes(api);
      await capacityRoutes(api);
      await adminRoutes(api);
      await importExportRoutes(api);
      await notificationRoutes(api);
    },
    { prefix: '/api/v1' },
  );

  return app;
}
