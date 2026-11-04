import { AuditQuerySchema, can } from '@wcrm/shared';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { auditLog, opportunities, users } from '../../db/schema/index';
import { AppError, notFound } from '../../lib/errors';
import { authOf, ok } from '../../lib/http';
import { parse } from '../../lib/validate';
import { assertVisible } from '../../services/opportunities';

/** Immutable audit log (ADM-10). Global view for ADM letters; per-opportunity with visibility. */
export async function auditRoutes(app: FastifyInstance) {
  const { db, rules } = app.ctx;

  app.get('/audit-log', { config: { session: true, guard: undefined } }, async (req) => {
    const q = parse(AuditQuerySchema, req.query);
    const auth = authOf(req);
    const { raci } = await rules.get();
    if (q.opportunityId) {
      const [o] = await db
        .select()
        .from(opportunities)
        .where(eq(opportunities.id, q.opportunityId));
      if (!o) throw notFound();
      await assertVisible(db, auth, o, raci);
    } else if (!can(auth.roles, 'ADM', 'view', raci)) {
      throw new AppError(403, 'FORBIDDEN');
    }
    const where: SQL[] = [];
    if (q.opportunityId) where.push(eq(auditLog.opportunityId, q.opportunityId));
    if (q.entityType) where.push(eq(auditLog.entityType, q.entityType));
    if (q.entityId) where.push(eq(auditLog.entityId, q.entityId));
    if (q.category) where.push(sql`${auditLog.category}::text = ${q.category}`);
    const cond = where.length ? and(...where) : undefined;
    const [rows, [{ total } = { total: 0 }]] = await Promise.all([
      db
        .select({
          id: auditLog.id,
          occurredAt: auditLog.occurredAt,
          actorUserId: auditLog.actorUserId,
          actorName: users.fullName,
          actorRoles: auditLog.actorRoles,
          action: auditLog.action,
          category: auditLog.category,
          entityType: auditLog.entityType,
          entityId: auditLog.entityId,
          opportunityId: auditLog.opportunityId,
          changes: auditLog.changes,
          reason: auditLog.reason,
          hash: sql<string>`encode(${auditLog.hash}, 'hex')`,
        })
        .from(auditLog)
        .leftJoin(users, eq(users.id, auditLog.actorUserId))
        .where(cond)
        .orderBy(desc(auditLog.id))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      db
        .select({ total: sql<number>`count(*)::int` })
        .from(auditLog)
        .where(cond),
    ]);
    return { data: rows, meta: { page: q.page, pageSize: q.pageSize, total } };
  });

  app.get(
    '/audit-log/verify',
    { config: { guard: { process: 'ADM', action: 'view' } } },
    async () => {
      const r = await db.execute<{ checked: string; first_broken_id: string | null }>(
        sql`SELECT checked::text, first_broken_id::text FROM audit_log_verify()`,
      );
      const row = r.rows[0]!;
      return ok({
        ok: row.first_broken_id === null,
        checked: Number(row.checked),
        firstBrokenId: row.first_broken_id,
      });
    },
  );
}
