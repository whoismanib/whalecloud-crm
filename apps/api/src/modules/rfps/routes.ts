import {
  can,
  rfpAlerts,
  rfpCompliance,
  RfpCreateSchema,
  rfpDateFailures,
  rfpDates,
  RfpDecisionSchema,
  RfpDeliverSchema,
  rfpDeliverFailures,
  rfpKpis,
  RfpRequirementsSchema,
  RfpRequirementUpdateSchema,
  RfpResultSchema,
  type ComplianceAnswer,
} from '@wcrm/shared';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recordAudit } from '../../audit/record';
import type { Db, DbOrTx } from '../../db/client';
import { accounts, opportunities, rfpRequirements, rfps, users } from '../../db/schema/index';
import { AppError, assertRules, notFound, ruleViolation } from '../../lib/errors';
import { actorOf, authOf, ok } from '../../lib/http';
import { parse } from '../../lib/validate';
import { moneyColumns } from '../../services/money';
import { notify } from '../../services/notify';
import { assertVisible, visibilityFilter } from '../../services/opportunities';
import type { RulesContext } from '../../services/rulesContext';
import type { AuthInfo } from '../../types';

type RfpRow = typeof rfps.$inferSelect;

/** Shape shared by the list, the detail and the KPIs (dates as YYYY-MM-DD). */
function view(r: RfpRow, today: string) {
  return {
    ...r,
    alerts: rfpAlerts(r, today),
    cmReviewedAt: r.cmReviewedAt?.toISOString() ?? null,
  };
}

async function loadRfp(db: DbOrTx, id: string) {
  const [r] = await db.select().from(rfps).where(eq(rfps.id, id));
  if (!r) throw notFound();
  return r;
}

async function requirementsOf(db: DbOrTx, rfpId: string) {
  return db
    .select({ q: rfpRequirements, assigneeName: users.fullName })
    .from(rfpRequirements)
    .leftJoin(users, eq(users.id, rfpRequirements.assigneeUserId))
    .where(eq(rfpRequirements.rfpId, rfpId))
    .orderBy(asc(rfpRequirements.createdAt), asc(rfpRequirements.ref));
}

/** Recomputes compliance %; any change to the matrix invalidates a previous CM review (P3-04). */
async function afterMatrixChange(db: DbOrTx, r: RfpRow) {
  const answers = (
    await db
      .select({ a: rfpRequirements.answer })
      .from(rfpRequirements)
      .where(eq(rfpRequirements.rfpId, r.id))
  ).map((x) => x.a as ComplianceAnswer);
  const c = rfpCompliance(answers);
  await db
    .update(rfps)
    .set({
      compliancePct: c.pct === null ? null : String(c.pct),
      ...(r.cmReviewedAt && !r.deliveredOn ? { cmReviewedAt: null, cmReviewedBy: null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(rfps.id, r.id));
}

async function assertRfpVisible(db: DbOrTx, auth: AuthInfo, r: RfpRow, ctx: RulesContext) {
  const [o] = await db.select().from(opportunities).where(eq(opportunities.id, r.opportunityId));
  if (!o) throw notFound();
  await assertVisible(db, auth, o, ctx.raci);
  return o;
}

export async function listRfps(db: Db, auth: AuthInfo, ctx: RulesContext, today: string) {
  const rows = await db
    .select({ r: rfps, opportunityName: opportunities.name, accountName: accounts.name })
    .from(rfps)
    .innerJoin(opportunities, eq(opportunities.id, rfps.opportunityId))
    .innerJoin(accounts, eq(accounts.id, opportunities.accountId))
    .where(visibilityFilter(auth, ctx.raci))
    .orderBy(desc(rfps.clientDeadline));
  return rows.map((x) => ({
    ...view(x.r, today),
    opportunityName: x.opportunityName,
    accountName: x.accountName,
  }));
}

/**
 * P3 Preventa RFI/RFP (API.md §7): registration with deadlines, participate/decline decision in
 * 2 business days ⚙, compliance matrix, internal milestone −5 business days ⚙, CM review before
 * delivery, result. KPIs "RFPs a tiempo" and "tasa de adjudicación" (KPIS.md §4).
 */
export async function rfpRoutes(app: FastifyInstance) {
  const { db, rules, mailer } = app.ctx;
  const idParam = z.object({ id: z.string().uuid() });

  app.get('/rfps', { config: { guard: { process: 'P3', action: 'view' } } }, async (req) => {
    const ctx = await rules.get();
    const list = await listRfps(db, authOf(req), ctx, req.today);
    return { data: list, meta: { kpis: rfpKpis(list) } };
  });

  app.get(
    '/opportunities/:id/rfps',
    { config: { guard: { process: 'P3', action: 'view' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const ctx = await rules.get();
      const [o] = await db.select().from(opportunities).where(eq(opportunities.id, id));
      if (!o) throw notFound();
      await assertVisible(db, authOf(req), o, ctx.raci);
      const list = await db
        .select()
        .from(rfps)
        .where(eq(rfps.opportunityId, id))
        .orderBy(desc(rfps.receivedOn));
      return ok(list.map((r) => view(r, req.today)));
    },
  );

  app.post(
    '/opportunities/:id/rfps',
    { config: { guard: { process: 'P3', action: 'write' } } },
    async (req, reply) => {
      const { id } = parse(idParam, req.params);
      const body = parse(RfpCreateSchema, req.body);
      const ctx = await rules.get();
      assertRules(rfpDateFailures(body.receivedOn, body.clientDeadline));
      const row = await db.transaction(async (tx) => {
        const [o] = await tx.select().from(opportunities).where(eq(opportunities.id, id));
        if (!o) throw notFound();
        await assertVisible(tx, authOf(req), o, ctx.raci);
        const d = rfpDates(body.receivedOn, body.clientDeadline, ctx.calendars.CL!, ctx.settings);
        const [r] = await tx
          .insert(rfps)
          .values({
            opportunityId: id,
            type: body.type,
            title: body.title,
            receivedOn: body.receivedOn,
            clientDeadline: body.clientDeadline,
            documentsUrl: body.documentsUrl ?? null,
            notes: body.notes ?? null,
            ...d,
            createdBy: authOf(req).user.id,
          })
          .returning();
        await recordAudit(tx, actorOf(req), {
          action: 'CREATE',
          category: 'DATA',
          entityType: 'rfp',
          entityId: r!.id,
          opportunityId: id,
          changes: [{ field: 'clientDeadline', old: null, new: body.clientDeadline }],
        });
        // P3-02: internal milestone visible to China Sales; P3-01: decision owner
        await notify(
          tx,
          {
            userIds: [o.ownerId],
            roles: ['CHINA_SALES'],
            type: 'RFP',
            titleKey: 'rfpRegistered',
            params: {
              title: body.title,
              decisionDueOn: d.decisionDueOn,
              internalDeadline: d.internalDeadline,
            },
            entityType: 'rfp',
            entityId: r!.id,
            link: '/preventa',
            dedupeKey: `rfp:${r!.id}:created`,
          },
          mailer,
        );
        return r!;
      });
      return reply.status(201).send(ok(view(row, req.today)));
    },
  );

  app.get('/rfps/:id', { config: { guard: { process: 'P3', action: 'view' } } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const ctx = await rules.get();
    const r = await loadRfp(db, id);
    const o = await assertRfpVisible(db, authOf(req), r, ctx);
    const reqs = await requirementsOf(db, id);
    return ok({
      ...view(r, req.today),
      opportunityName: o.name,
      compliance: rfpCompliance(reqs.map((x) => x.q.answer as ComplianceAnswer)),
      requirements: reqs.map((x) => ({ ...x.q, assigneeName: x.assigneeName })),
    });
  });

  app.post(
    '/rfps/:id/decision',
    { config: { guard: { process: 'P3', action: 'write' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const body = parse(RfpDecisionSchema, req.body);
      const ctx = await rules.get();
      const r = await loadRfp(db, id);
      await assertRfpVisible(db, authOf(req), r, ctx);
      if (r.decision !== 'PENDING')
        throw ruleViolation([{ code: 'STATUS_INVALID', params: { status: r.decision } }]);
      if (body.decision === 'DECLINE' && !body.reason?.trim())
        throw ruleViolation([{ code: 'COMMENT_REQUIRED' }]);
      const [u] = await db
        .update(rfps)
        .set({
          decision: body.decision,
          decisionReason: body.reason ?? null,
          decidedOn: req.today,
          decidedAt: new Date(),
          decidedBy: authOf(req).user.id,
          updatedAt: new Date(),
        })
        .where(eq(rfps.id, id))
        .returning();
      await recordAudit(db, actorOf(req), {
        action: 'UPDATE',
        category: 'DATA',
        entityType: 'rfp',
        entityId: id,
        opportunityId: r.opportunityId,
        changes: [{ field: 'decision', old: 'PENDING', new: body.decision }],
        reason: body.reason ?? null,
      });
      return ok(view(u!, req.today));
    },
  );

  app.post(
    '/rfps/:id/requirements',
    { config: { guard: { process: 'P3', action: 'write' } } },
    async (req, reply) => {
      const { id } = parse(idParam, req.params);
      const body = parse(RfpRequirementsSchema, req.body);
      const ctx = await rules.get();
      const r = await loadRfp(db, id);
      await assertRfpVisible(db, authOf(req), r, ctx);
      if (r.deliveredOn) throw ruleViolation([{ code: 'RFP_ALREADY_DELIVERED' }]);
      const rows = await db.transaction(async (tx) => {
        const ins = await tx
          .insert(rfpRequirements)
          .values(
            body.map((x) => ({
              rfpId: id,
              ref: x.ref ?? null,
              requirement: x.requirement,
              assigneeUserId: x.assigneeUserId ?? null,
              createdBy: authOf(req).user.id,
            })),
          )
          .returning();
        await afterMatrixChange(tx, r);
        return ins;
      });
      return reply.status(201).send(ok(rows));
    },
  );

  /** P3-03: answered by P3 R/A or by the assignee (e.g. Lin Han, Alex Kong, I+D). */
  app.patch('/rfp-requirements/:id', { config: { session: true } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const body = parse(RfpRequirementUpdateSchema, req.body);
    const ctx = await rules.get();
    const auth = authOf(req);
    const [q] = await db.select().from(rfpRequirements).where(eq(rfpRequirements.id, id));
    if (!q) throw notFound();
    const writer = can(auth.roles, 'P3', 'write', ctx.raci);
    if (!writer && q.assigneeUserId !== auth.user.id) throw new AppError(403, 'FORBIDDEN');
    if (!writer && body.assigneeUserId !== undefined) throw new AppError(403, 'FORBIDDEN');
    const r = await loadRfp(db, q.rfpId);
    if (writer) await assertRfpVisible(db, auth, r, ctx);
    if (r.deliveredOn) throw ruleViolation([{ code: 'RFP_ALREADY_DELIVERED' }]);
    const answered = body.answer !== undefined && body.answer !== q.answer;
    const row = await db.transaction(async (tx) => {
      const [u] = await tx
        .update(rfpRequirements)
        .set({
          ...(body.answer !== undefined ? { answer: body.answer } : {}),
          ...(body.comment !== undefined ? { comment: body.comment } : {}),
          ...(body.assigneeUserId !== undefined ? { assigneeUserId: body.assigneeUserId } : {}),
          ...(answered ? { answeredBy: auth.user.id, answeredAt: new Date() } : {}),
          updatedAt: new Date(),
          updatedBy: auth.user.id,
        })
        .where(eq(rfpRequirements.id, id))
        .returning();
      await afterMatrixChange(tx, r);
      await recordAudit(tx, actorOf(req), {
        action: 'UPDATE',
        category: 'DATA',
        entityType: 'rfp_requirement',
        entityId: id,
        opportunityId: r.opportunityId,
        changes: answered ? [{ field: 'answer', old: q.answer, new: body.answer }] : [],
      });
      if (body.assigneeUserId && body.assigneeUserId !== q.assigneeUserId)
        await notify(
          tx,
          {
            userIds: [body.assigneeUserId],
            type: 'RFP',
            titleKey: 'rfpRequirementAssigned',
            params: { title: r.title },
            entityType: 'rfp',
            entityId: r.id,
            link: '/preventa',
            dedupeKey: `rfp-req:${id}:${body.assigneeUserId}`,
          },
          mailer,
        );
      return u!;
    });
    return ok(row);
  });

  app.post(
    '/rfps/:id/cm-review',
    { config: { guard: { process: 'P3', action: 'approve' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const body = parse(
        z.object({ comment: z.string().max(2000).optional().nullable() }),
        req.body,
      );
      const ctx = await rules.get();
      const r = await loadRfp(db, id);
      await assertRfpVisible(db, authOf(req), r, ctx);
      const [{ pending } = { pending: 0 }] = await db
        .select({ pending: sql<number>`count(*)::int` })
        .from(rfpRequirements)
        .where(and(eq(rfpRequirements.rfpId, id), eq(rfpRequirements.answer, 'PENDING')));
      assertRules(
        rfpDeliverFailures({ ...r, cmReviewedAt: 'pending-review' }, pending).filter(
          (f) => f.code !== 'RFP_CM_REVIEW_REQUIRED',
        ),
      );
      const [u] = await db
        .update(rfps)
        .set({
          cmReviewedAt: new Date(),
          cmReviewedBy: authOf(req).user.id,
          cmReviewComment: body.comment ?? null,
          updatedAt: new Date(),
        })
        .where(eq(rfps.id, id))
        .returning();
      await recordAudit(db, actorOf(req), {
        action: 'APPROVAL_DECISION',
        category: 'APPROVAL',
        entityType: 'rfp',
        entityId: id,
        opportunityId: r.opportunityId,
        changes: [{ field: 'cmReviewedAt', old: null, new: u!.cmReviewedAt }],
        reason: body.comment ?? null,
      });
      return ok(view(u!, req.today));
    },
  );

  app.post(
    '/rfps/:id/deliver',
    { config: { guard: { process: 'P3', action: 'write' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const body = parse(RfpDeliverSchema, req.body ?? {});
      const ctx = await rules.get();
      const r = await loadRfp(db, id);
      await assertRfpVisible(db, authOf(req), r, ctx);
      const [{ pending } = { pending: 0 }] = await db
        .select({ pending: sql<number>`count(*)::int` })
        .from(rfpRequirements)
        .where(and(eq(rfpRequirements.rfpId, id), eq(rfpRequirements.answer, 'PENDING')));
      assertRules(
        rfpDeliverFailures({ ...r, cmReviewedAt: r.cmReviewedAt?.toISOString() ?? null }, pending),
      );
      const deliveredOn = body.deliveredOn ?? req.today;
      if (deliveredOn > req.today || deliveredOn < r.receivedOn)
        throw ruleViolation([{ code: 'DATE_RANGE_INVALID' }]);
      const [u] = await db
        .update(rfps)
        .set({ deliveredOn, deliveredAt: new Date(), updatedAt: new Date() })
        .where(eq(rfps.id, id))
        .returning();
      await recordAudit(db, actorOf(req), {
        action: 'UPDATE',
        category: 'DATA',
        entityType: 'rfp',
        entityId: id,
        opportunityId: r.opportunityId,
        changes: [{ field: 'deliveredOn', old: null, new: deliveredOn }],
      });
      return ok(view(u!, req.today));
    },
  );

  app.post(
    '/rfps/:id/result',
    { config: { guard: { process: 'P3', action: 'write' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const body = parse(RfpResultSchema, req.body);
      const ctx = await rules.get();
      const r = await loadRfp(db, id);
      await assertRfpVisible(db, authOf(req), r, ctx);
      if (body.result !== 'CANCELLED' && !r.deliveredOn)
        throw ruleViolation([{ code: 'RFP_NOT_DELIVERED' }]);
      const [u] = await db
        .update(rfps)
        .set({
          result: body.result,
          winningCompetitor: body.winningCompetitor ?? null,
          ...moneyColumns(
            'winningPrice',
            body.winningPrice ?? null,
            body.winningCurrency ?? null,
            req.today,
            ctx.fx,
          ),
          updatedAt: new Date(),
        })
        .where(eq(rfps.id, id))
        .returning();
      await recordAudit(db, actorOf(req), {
        action: 'UPDATE',
        category: 'DATA',
        entityType: 'rfp',
        entityId: id,
        opportunityId: r.opportunityId,
        changes: [{ field: 'result', old: r.result, new: body.result }],
      });
      return ok(view(u!, req.today));
    },
  );
}
