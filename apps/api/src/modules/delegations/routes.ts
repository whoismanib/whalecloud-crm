import { can, DelegationCreateSchema, delegationFailures, type UserRole } from '@wcrm/shared';
import { and, desc, eq, or } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recordAudit } from '../../audit/record';
import { approvalDelegations, userRoles, users } from '../../db/schema/index';
import { AppError, assertRules, notFound, ruleViolation } from '../../lib/errors';
import { actorOf, authOf, ok } from '../../lib/http';
import { parse } from '../../lib/validate';
import { notify } from '../../services/notify';

/** ADM-04: temporary delegation of approvals (absences), audited; DELETE = revoke. */
export async function delegationRoutes(app: FastifyInstance) {
  const { db, rules, mailer } = app.ctx;
  const delegator = alias(users, 'delegator');
  const delegate = alias(users, 'delegate');

  app.get('/delegations', { config: { session: true } }, async (req) => {
    const auth = authOf(req);
    const all = can(auth.roles, 'ADM', 'view', (await rules.get()).raci);
    const rows = await db
      .select({
        d: approvalDelegations,
        delegatorName: delegator.fullName,
        delegateName: delegate.fullName,
      })
      .from(approvalDelegations)
      .innerJoin(delegator, eq(delegator.id, approvalDelegations.delegatorUserId))
      .innerJoin(delegate, eq(delegate.id, approvalDelegations.delegateUserId))
      .where(
        all
          ? undefined
          : or(
              eq(approvalDelegations.delegatorUserId, auth.user.id),
              eq(approvalDelegations.delegateUserId, auth.user.id),
            ),
      )
      .orderBy(desc(approvalDelegations.startsOn));
    return ok(
      rows.map((r) => ({
        ...r.d,
        delegatorName: r.delegatorName,
        delegateName: r.delegateName,
        active: !r.d.revokedAt && r.d.startsOn <= req.today && req.today <= r.d.endsOn,
      })),
    );
  });

  app.post('/delegations', { config: { session: true } }, async (req, reply) => {
    const auth = authOf(req);
    const body = parse(DelegationCreateSchema, req.body);
    const ctx = await rules.get();
    const delegatorUserId = body.delegatorUserId ?? auth.user.id;
    if (delegatorUserId !== auth.user.id && !can(auth.roles, 'ADM', 'write', ctx.raci))
      throw new AppError(403, 'FORBIDDEN');
    const roles = (
      await db
        .select({ r: userRoles.role })
        .from(userRoles)
        .where(eq(userRoles.userId, delegatorUserId))
    ).map((x) => x.r as UserRole);
    const [target] = await db
      .select()
      .from(users)
      .where(and(eq(users.id, body.delegateUserId), eq(users.isActive, true)));
    if (!target) throw ruleViolation([{ code: 'DELEGATE_NOT_FOUND' }]);
    const d = { ...body, delegatorUserId };
    assertRules(delegationFailures(d, roles, req.today));
    const row = await db.transaction(async (tx) => {
      const [r] = await tx
        .insert(approvalDelegations)
        .values({ ...d, createdBy: auth.user.id })
        .returning();
      await recordAudit(tx, actorOf(req), {
        action: 'CREATE',
        category: 'APPROVAL',
        entityType: 'approval_delegation',
        entityId: r!.id,
        changes: [
          { field: 'delegateUserId', old: null, new: d.delegateUserId },
          { field: 'role', old: null, new: d.role },
          { field: 'period', old: null, new: `${d.startsOn}..${d.endsOn}` },
        ],
        reason: d.reason,
      });
      await notify(
        tx,
        {
          userIds: [d.delegateUserId],
          type: 'DELEGATION',
          titleKey: 'delegationReceived',
          params: { role: d.role, startsOn: d.startsOn, endsOn: d.endsOn },
          entityType: 'approval_delegation',
          entityId: r!.id,
          link: '/aprobaciones',
          dedupeKey: `delegation:${r!.id}`,
        },
        mailer,
      );
      return r!;
    });
    return reply.status(201).send(ok(row));
  });

  app.delete('/delegations/:id', { config: { session: true } }, async (req) => {
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const auth = authOf(req);
    const [d] = await db.select().from(approvalDelegations).where(eq(approvalDelegations.id, id));
    if (!d) throw notFound();
    if (
      d.delegatorUserId !== auth.user.id &&
      !can(auth.roles, 'ADM', 'write', (await rules.get()).raci)
    )
      throw new AppError(403, 'FORBIDDEN');
    if (d.revokedAt) return ok(d);
    const [u] = await db
      .update(approvalDelegations)
      .set({ revokedAt: new Date(), revokedBy: auth.user.id, updatedAt: new Date() })
      .where(eq(approvalDelegations.id, id))
      .returning();
    await recordAudit(db, actorOf(req), {
      action: 'UPDATE',
      category: 'APPROVAL',
      entityType: 'approval_delegation',
      entityId: id,
      changes: [{ field: 'revokedAt', old: null, new: u!.revokedAt }],
    });
    return ok(u);
  });
}
