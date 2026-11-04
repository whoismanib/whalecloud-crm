import { can, EngagementQuerySchema, LegacyMailImportSchema } from '@wcrm/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { recordAudit } from '../../audit/record';
import { importJobs, users } from '../../db/schema/index';
import { AppError } from '../../lib/errors';
import { actorOf, authOf, ok } from '../../lib/http';
import { parse } from '../../lib/validate';
import { inTx } from '../imports/service';
import { computeEngagement, importLegacyMailCache, instantFor } from './service';

/** Roles that may read every mailbox's engagement aggregates (ADR 0008 §Acceso). */
const ALL_MAILBOX_ROLES = ['COUNTRY_MANAGER', 'LATAM_PRESIDENT', 'ADMIN'] as const;

/** Mail / calendar sync, phase 0: import of the legacy `crm_cache.json` (ADR 0008). */
export async function mailRoutes(app: FastifyInstance) {
  const { db, rules, config } = app.ctx;

  app.post(
    '/mail/legacy-cache',
    { bodyLimit: 5_242_880, config: { guard: { process: 'P1', action: 'write' } } },
    async (req) => {
      const body = parse(LegacyMailImportSchema, req.body);
      const auth = authOf(req);
      const actor = actorOf(req);
      let ownerId = auth.user.id;
      if (body.userId && body.userId !== auth.user.id) {
        const ctx = await rules.get();
        if (!can(auth.roles, 'ADM', 'write', ctx.raci)) throw new AppError(403, 'FORBIDDEN');
        const [u] = await db.select({ id: users.id }).from(users).where(eq(users.id, body.userId));
        if (!u) throw new AppError(404, 'NOT_FOUND');
        ownerId = u.id;
      }
      const report = await inTx(db, body.dryRun, (tx) =>
        importLegacyMailCache(tx, actor, ownerId, body.data, {
          timeZone: auth.user.timezone || config.APP_TIMEZONE,
          aliases: body.aliases,
        }),
      );
      const [job] = await db
        .insert(importJobs)
        .values({
          kind: 'LEGACY_MAIL_CACHE',
          dryRun: body.dryRun,
          rowsTotal: report.rowsTotal,
          rowsOk: report.rowsOk,
          rowsError: report.errors.length,
          report: {
            created: report.created,
            skipped: report.skipped,
            errors: report.errors,
            generatedAt: report.generatedAt,
            ownerUserId: ownerId,
          },
          createdBy: actor.userId,
        })
        .returning({ id: importJobs.id });
      await recordAudit(db, actor, {
        action: 'IMPORT',
        category: 'DATA',
        entityType: 'import_job',
        entityId: job!.id,
        changes: [
          {
            field: 'legacy-mail-cache',
            old: null,
            new: {
              ...report.created,
              ownerUserId: ownerId,
              generatedAt: report.generatedAt,
              errors: report.errors.length,
              dryRun: body.dryRun,
            },
          },
        ],
      });
      return ok({ id: job!.id, dryRun: body.dryRun, ...report });
    },
  );

  /** Legacy "Salud por cliente", "Correos (30d)" and "Stale / On Hold" (LEGACY-DASHBOARD.md). */
  app.get(
    '/dashboard/engagement',
    { config: { guard: { process: 'DASH', action: 'view' } } },
    async (req) => {
      const q = parse(EngagementQuerySchema, req.query);
      const auth = authOf(req);
      const all =
        q.scope === 'all' && auth.roles.some((r) => ALL_MAILBOX_ROLES.includes(r as never));
      return ok({
        scope: all ? 'all' : 'mine',
        ...(await computeEngagement(
          db,
          all ? 'ALL' : [auth.user.id],
          instantFor(req.today, config.APP_TIMEZONE),
        )),
      });
    },
  );
}
