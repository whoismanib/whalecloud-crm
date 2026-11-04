import { can, CostEstimateAssignSchema, CostEstimateUpdateSchema } from '@wcrm/shared';
import { asc, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recordAudit } from '../../audit/record';
import { costEstimates, opportunities, priceRequests, users } from '../../db/schema/index';
import { AppError, notFound, ruleViolation } from '../../lib/errors';
import { actorOf, authOf, ok } from '../../lib/http';
import { parse } from '../../lib/validate';
import { notify } from '../../services/notify';
import { assertVisible } from '../../services/opportunities';

const OPEN_PR = ['SUBMITTED', 'COSTING', 'BUILDING'];

/**
 * P5-04: China Sales assigns person-month cost estimates to R&D / delivery China; the assignee
 * records the person-months per resource type and signs (author + date). Notifications are
 * rendered in the recipient's language by the client (title key + params).
 */
export async function costEstimateRoutes(app: FastifyInstance) {
  const { db, rules, mailer } = app.ctx;
  const idParam = z.object({ id: z.string().uuid() });
  const signer = alias(users, 'signer');

  async function loadPr(id: string) {
    const [pr] = await db.select().from(priceRequests).where(eq(priceRequests.id, id));
    if (!pr) throw notFound();
    return pr;
  }

  app.get(
    '/price-requests/:id/cost-estimates',
    { config: { guard: { process: 'P5', action: 'view' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      await loadPr(id);
      const rows = await db
        .select({ e: costEstimates, assigneeName: users.fullName, signedByName: signer.fullName })
        .from(costEstimates)
        .innerJoin(users, eq(users.id, costEstimates.assigneeUserId))
        .leftJoin(signer, eq(signer.id, costEstimates.signedBy))
        .where(eq(costEstimates.priceRequestId, id))
        .orderBy(asc(costEstimates.createdAt));
      return ok(
        rows.map((r) => ({ ...r.e, assigneeName: r.assigneeName, signedByName: r.signedByName })),
      );
    },
  );

  app.post(
    '/price-requests/:id/cost-estimates',
    { config: { guard: { process: 'P5', action: 'write' } } },
    async (req, reply) => {
      const { id } = parse(idParam, req.params);
      const body = parse(CostEstimateAssignSchema, req.body);
      const ctx = await rules.get();
      const pr = await loadPr(id);
      const [o] = await db
        .select()
        .from(opportunities)
        .where(eq(opportunities.id, pr.opportunityId));
      await assertVisible(db, authOf(req), o!, ctx.raci);
      if (!OPEN_PR.includes(pr.status))
        throw ruleViolation([{ code: 'STATUS_INVALID', params: { status: pr.status } }]);
      const rows = await db.transaction(async (tx) => {
        const ins = await tx
          .insert(costEstimates)
          .values(
            body.map((x) => ({
              ...x,
              notes: x.notes ?? null,
              priceRequestId: id,
              createdBy: authOf(req).user.id,
            })),
          )
          .returning();
        if (pr.status === 'SUBMITTED')
          await tx
            .update(priceRequests)
            .set({ status: 'COSTING', updatedAt: new Date() })
            .where(eq(priceRequests.id, id));
        for (const e of ins) {
          await recordAudit(tx, actorOf(req), {
            action: 'CREATE',
            category: 'PRICE',
            entityType: 'cost_estimate',
            entityId: e.id,
            opportunityId: pr.opportunityId,
            changes: [{ field: 'assigneeUserId', old: null, new: e.assigneeUserId }],
          });
          await notify(
            tx,
            {
              userIds: [e.assigneeUserId],
              type: 'COST_ESTIMATE',
              titleKey: 'costEstimateAssigned',
              params: { name: o!.name, area: e.area },
              entityType: 'opportunity',
              entityId: pr.opportunityId,
              link: `/oportunidades/${pr.opportunityId}`,
              dedupeKey: `cost:${e.id}`,
            },
            mailer,
          );
        }
        return ins;
      });
      return reply.status(201).send(ok(rows));
    },
  );

  /** The assignee (or P5 R/A) records person-months; any change clears a previous signature. */
  app.patch('/cost-estimates/:id', { config: { session: true } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(CostEstimateUpdateSchema, req.body);
    const auth = authOf(req);
    const [e] = await db.select().from(costEstimates).where(eq(costEstimates.id, id));
    if (!e) throw notFound();
    if (
      e.assigneeUserId !== auth.user.id &&
      !can(auth.roles, 'P5', 'write', (await rules.get()).raci)
    )
      throw new AppError(403, 'FORBIDDEN');
    const pr = await loadPr(e.priceRequestId);
    if (!OPEN_PR.includes(pr.status))
      throw ruleViolation([{ code: 'STATUS_INVALID', params: { status: pr.status } }]);
    const [u] = await db
      .update(costEstimates)
      .set({
        ...(body.personMonths !== undefined ? { personMonths: body.personMonths } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        signedBy: null,
        signedAt: null,
        updatedAt: new Date(),
        updatedBy: auth.user.id,
      })
      .where(eq(costEstimates.id, id))
      .returning();
    await recordAudit(db, actorOf(req), {
      action: 'UPDATE',
      category: 'PRICE',
      entityType: 'cost_estimate',
      entityId: id,
      opportunityId: pr.opportunityId,
      changes: [{ field: 'personMonths', old: e.personMonths, new: u!.personMonths }],
    });
    return ok(u);
  });

  /** Signature of the estimate: only the assignee, once person-months are recorded. */
  app.post('/cost-estimates/:id/sign', { config: { session: true } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const auth = authOf(req);
    const [e] = await db.select().from(costEstimates).where(eq(costEstimates.id, id));
    if (!e) throw notFound();
    if (e.assigneeUserId !== auth.user.id) throw new AppError(403, 'FORBIDDEN');
    if (e.personMonths === null) throw ruleViolation([{ code: 'COST_ESTIMATE_EMPTY' }]);
    const pr = await loadPr(e.priceRequestId);
    const [u] = await db
      .update(costEstimates)
      .set({ signedBy: auth.user.id, signedAt: new Date(), updatedAt: new Date() })
      .where(eq(costEstimates.id, id))
      .returning();
    await recordAudit(db, actorOf(req), {
      action: 'APPROVAL_DECISION',
      category: 'PRICE',
      entityType: 'cost_estimate',
      entityId: id,
      opportunityId: pr.opportunityId,
      changes: [{ field: 'signedAt', old: null, new: u!.signedAt }],
    });
    return ok(u);
  });
}
