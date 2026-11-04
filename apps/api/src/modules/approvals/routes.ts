import {
  addBusinessDays,
  addDays,
  ApprovalRequestCreateSchema,
  DecisionSchema,
  detectConditions,
  routeApproval,
  validateApprovalRequest,
  type UserRole,
} from '@wcrm/shared';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recordAudit } from '../../audit/record';
import { delegatedFor } from '../../services/delegations';
import type { DbOrTx } from '../../db/client';
import {
  accounts,
  approvalRequests,
  approvalSteps,
  businessCases,
  opportunities,
  opportunityAssignments,
  priceRequests,
  userRoles,
  users,
} from '../../db/schema/index';
import { AppError, notFound, ruleViolation } from '../../lib/errors';
import { actorOf, authOf, ok } from '../../lib/http';
import { parse } from '../../lib/validate';
import { assertVisible, lockOpportunity } from '../../services/opportunities';
import type { RulesContext } from '../../services/rulesContext';
import { loadSheet, toLineInputs } from '../price-requests/routes';

/** China-side approvers use the CN calendar for their SLA; the rest use CL (ADM-06). */
const CN_ROLES: UserRole[] = [
  'CHINA_SALES',
  'CHINA_DELIVERY',
  'CHINA_FINANCE',
  'CHINA_LEGAL',
  'VP',
];

async function previewFor(db: DbOrTx, sheetId: string, ctx: RulesContext) {
  const sheet = await loadSheet(db, sheetId);
  const conditions = detectConditions(
    {
      paymentTermDays: sheet.paymentTermDays,
      clpWithoutFxPremium: sheet.clpWithoutFxPremium,
      penaltyCapPct: sheet.penaltyCapPct,
      unlimitedLiability: sheet.unlimitedLiability,
    },
    ctx.settings,
  );
  return { sheet, route: routeApproval(toLineInputs(sheet.lineItems), conditions, ctx.settings) };
}

async function hasApprovedBusinessCase(db: DbOrTx, oppId: string, bcId?: string | null) {
  const where = [eq(businessCases.opportunityId, oppId), eq(businessCases.status, 'APPROVED')];
  if (bcId) where.push(eq(businessCases.id, bcId));
  const [bc] = await db
    .select({ id: businessCases.id })
    .from(businessCases)
    .where(and(...where))
    .limit(1);
  return bc?.id ?? null;
}

export async function approvalRoutes(app: FastifyInstance) {
  const { db, rules } = app.ctx;
  const idParam = z.object({ id: z.string().uuid() });

  /** P6-02: preview of the matrix (same rule the request uses). */
  app.get(
    '/sheet-versions/:id/approval-preview',
    { config: { guard: { process: 'P6', action: 'view' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const ctx = await rules.get();
      const { sheet, route } = await previewFor(db, id, ctx);
      const bcId = await hasApprovedBusinessCase(db, sheet.opportunityId);
      const steps = route.steps.map((s) => ({
        ...s,
        dueOn: addBusinessDays(
          req.today,
          ctx.settings['sla.businessDays'].P6_APPROVAL,
          ctx.calendars[CN_ROLES.includes(s.assigneeRole) ? 'CN' : 'CL']!,
        ),
      }));
      return ok({
        ...route,
        steps,
        businessCaseApproved: Boolean(bcId),
        pendingRequirements: validateApprovalRequest(route, {
          competitiveJustification: 'preview',
          businessCaseApproved: Boolean(bcId),
        }),
      });
    },
  );

  app.post(
    '/sheet-versions/:id/approval-requests',
    { config: { guard: { process: 'P6', action: 'write' } } },
    async (req, reply) => {
      const { id } = parse(idParam, req.params);
      const body = parse(ApprovalRequestCreateSchema, req.body ?? {});
      const ctx = await rules.get();
      const auth = authOf(req);
      const row = await db.transaction(async (tx) => {
        const { sheet, route } = await previewFor(tx, id, ctx);
        const opp = await lockOpportunity(tx, sheet.opportunityId);
        await assertVisible(tx, auth, opp, ctx.raci);
        if (!sheet.isCurrent) throw ruleViolation([{ code: 'SHEET_NOT_CURRENT' }]);
        const bcId = await hasApprovedBusinessCase(tx, opp.id, body.businessCaseId);
        const failures = validateApprovalRequest(route, {
          competitiveJustification: body.competitiveJustification,
          businessCaseApproved: Boolean(bcId),
        });
        if (failures.length) throw ruleViolation(failures);
        const [pending] = await tx
          .select({ id: approvalRequests.id })
          .from(approvalRequests)
          .where(
            and(eq(approvalRequests.opportunityId, opp.id), eq(approvalRequests.status, 'PENDING')),
          );
        if (pending) throw ruleViolation([{ code: 'APPROVAL_ALREADY_PENDING' }]);

        const [ar] = await tx
          .insert(approvalRequests)
          .values({
            opportunityId: opp.id,
            sheetVersionId: id,
            band: route.band,
            marginBasis: ctx.settings['approval.marginBasis'],
            netMargin: sheet.netMargin,
            contractMargin: sheet.contractMargin,
            minLineMargin: route.minLineMargin,
            competitiveJustification: body.competitiveJustification ?? null,
            businessCaseId: bcId,
            conditions: route.conditions,
            validDays: ctx.settings['approval.validDays'],
            rulesSnapshot: {
              thresholds: ctx.settings['approval.thresholds'],
              marginBasis: ctx.settings['approval.marginBasis'],
              targets: ctx.settings['margins.targets'],
              validDays: ctx.settings['approval.validDays'],
              presidentCoApprovesVpBand: ctx.settings['approval.presidentCoApprovesVpBand'],
              nonEconomic: ctx.settings['approval.nonEconomic'],
              lines: route.lines,
            },
            requestedBy: auth.user.id,
            createdBy: auth.user.id,
          })
          .returning();
        for (const s of route.steps) {
          const [assignee] = await tx
            .select({ id: users.id })
            .from(users)
            .innerJoin(userRoles, eq(userRoles.userId, users.id))
            .where(and(eq(userRoles.role, s.assigneeRole), eq(users.isActive, true)))
            .orderBy(asc(users.createdAt))
            .limit(1);
          const cal = ctx.calendars[CN_ROLES.includes(s.assigneeRole) ? 'CN' : 'CL']!;
          await tx.insert(approvalSteps).values({
            approvalRequestId: ar!.id,
            seq: s.seq,
            kind: s.kind,
            condition: s.condition,
            assigneeRole: s.assigneeRole,
            assigneeUserId: assignee?.id ?? null,
            consultedRoles: s.consultedRoles,
            informedRoles: s.informedRoles,
            dueOn: addBusinessDays(req.today, ctx.settings['sla.businessDays'].P6_APPROVAL, cal),
          });
          if (assignee) {
            await tx
              .insert(opportunityAssignments)
              .values({ opportunityId: opp.id, userId: assignee.id, reason: 'APPROVAL_STEP' })
              .onConflictDoNothing();
          }
        }
        await tx
          .update(opportunities)
          .set({ currentApprovalRequestId: ar!.id })
          .where(eq(opportunities.id, opp.id));
        await tx
          .update(priceRequests)
          .set({
            status: 'READY_FOR_APPROVAL',
            currentHolderRole: route.steps[0]?.assigneeRole ?? null,
          })
          .where(eq(priceRequests.id, sheet.priceRequestId));
        await recordAudit(tx, actorOf(req), {
          action: 'APPROVAL_REQUEST',
          category: 'APPROVAL',
          entityType: 'approval_request',
          entityId: ar!.id,
          opportunityId: opp.id,
          accountId: opp.accountId,
          changes: [
            { field: 'band', old: null, new: route.band },
            { field: 'netMargin', old: null, new: sheet.netMargin },
            { field: 'conditions', old: null, new: route.conditions },
          ],
          reason: body.competitiveJustification ?? null,
        });
        return ar!;
      });
      return reply.status(201).send(ok(row));
    },
  );

  /** Approver inbox (P6-04): pending steps assigned to one of my roles or to me. */
  app.get('/approvals', { config: { session: true } }, async (req) => {
    const auth = authOf(req);
    const q = parse(
      z.object({ status: z.string().optional(), assignedToMe: z.string().optional() }),
      req.query,
    );
    const where = [eq(approvalSteps.status, (q.status ?? 'PENDING') as 'PENDING')];
    // ADM-04: roles delegated to me today also land in my inbox
    const delegated = await delegatedFor(db, auth.user.id, req.today);
    const myRoles = [...new Set([...auth.roles, ...delegated.roles])];
    if (q.assignedToMe !== 'false') {
      where.push(
        sql`(${approvalSteps.assigneeUserId} = ${auth.user.id} OR ${approvalSteps.assigneeRole}::text IN (${sql.join(
          myRoles.map((r) => sql`${r}`),
          sql`, `,
        )}))`,
      );
    }
    const rows = await db
      .select({
        step: approvalSteps,
        request: approvalRequests,
        opportunityName: opportunities.name,
        opportunityCode: opportunities.code,
        opportunityId: opportunities.id,
        accountName: accounts.name,
        amountUsd: opportunities.amountUsd,
        requestedByName: users.fullName,
      })
      .from(approvalSteps)
      .innerJoin(approvalRequests, eq(approvalRequests.id, approvalSteps.approvalRequestId))
      .innerJoin(opportunities, eq(opportunities.id, approvalRequests.opportunityId))
      .innerJoin(accounts, eq(accounts.id, opportunities.accountId))
      .leftJoin(users, eq(users.id, approvalRequests.requestedBy))
      .where(and(...where))
      .orderBy(asc(approvalSteps.dueOn));
    return ok(
      rows.map((r) => ({
        ...r.step,
        request: r.request,
        opportunityName: r.opportunityName,
        opportunityCode: r.opportunityCode,
        opportunityId: r.opportunityId,
        accountName: r.accountName,
        amountUsd: r.amountUsd,
        requestedByName: r.requestedByName,
        overdue: r.step.dueOn !== null && r.step.dueOn < req.today,
        delegated:
          r.step.assigneeUserId !== auth.user.id && !auth.roles.includes(r.step.assigneeRole),
      })),
    );
  });

  app.get('/approval-requests/:id', { config: { session: true } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const [ar] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, id));
    if (!ar) throw notFound();
    const [opp] = await db
      .select()
      .from(opportunities)
      .where(eq(opportunities.id, ar.opportunityId));
    await assertVisible(db, authOf(req), opp!, (await rules.get()).raci);
    const steps = await db
      .select({ step: approvalSteps, assigneeName: users.fullName })
      .from(approvalSteps)
      .leftJoin(users, eq(users.id, approvalSteps.assigneeUserId))
      .where(eq(approvalSteps.approvalRequestId, id))
      .orderBy(asc(approvalSteps.seq));
    return ok({ ...ar, steps: steps.map((s) => ({ ...s.step, assigneeName: s.assigneeName })) });
  });

  app.get(
    '/opportunities/:id/approval-requests',
    { config: { guard: { process: 'P6', action: 'view' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const rows = await db
        .select()
        .from(approvalRequests)
        .where(eq(approvalRequests.opportunityId, id))
        .orderBy(desc(approvalRequests.requestedAt));
      const steps = rows.length
        ? await db
            .select({ step: approvalSteps, assigneeName: users.fullName })
            .from(approvalSteps)
            .leftJoin(users, eq(users.id, approvalSteps.assigneeUserId))
            .where(
              inArray(
                approvalSteps.approvalRequestId,
                rows.map((r) => r.id),
              ),
            )
            .orderBy(asc(approvalSteps.seq))
        : [];
      return ok(
        rows.map((r) => ({
          ...r,
          steps: steps
            .filter((s) => s.step.approvalRequestId === r.id)
            .map((s) => ({ ...s.step, assigneeName: s.assigneeName })),
        })),
      );
    },
  );

  /** P6-04: decide a step. Only the assignee role/user; comment mandatory unless approved. */
  app.post(
    '/approval-steps/:id/decision',
    { config: { session: true, guard: { process: 'P6', action: 'view', extra: 'assignee role' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const body = parse(DecisionSchema, req.body);
      const auth = authOf(req);
      if (body.decision !== 'APPROVED' && !body.comment?.trim()) {
        throw ruleViolation([{ code: 'COMMENT_REQUIRED' }]);
      }
      return ok(
        await db.transaction(async (tx) => {
          const [step] = await tx
            .select()
            .from(approvalSteps)
            .where(eq(approvalSteps.id, id))
            .for('update');
          if (!step) throw notFound();
          const own =
            step.assigneeUserId === auth.user.id || auth.roles.includes(step.assigneeRole);
          // ADM-04: a delegate acts for the absent role holder; the audit keeps on whose behalf
          const onBehalfOf = own
            ? []
            : (await delegatedFor(tx, auth.user.id, req.today)).onBehalfOf.filter(
                (x) => x.role === step.assigneeRole,
              );
          if (!own && !onBehalfOf.length) throw new AppError(403, 'FORBIDDEN');
          const [ar] = await tx
            .select()
            .from(approvalRequests)
            .where(eq(approvalRequests.id, step.approvalRequestId))
            .for('update');
          if (!ar || ar.status !== 'PENDING' || step.status !== 'PENDING') {
            throw ruleViolation([
              { code: 'APPROVAL_NOT_PENDING', params: { status: ar?.status ?? null } },
            ]);
          }
          await tx
            .update(approvalSteps)
            .set({
              status: body.decision,
              decidedBy: auth.user.id,
              decidedAt: new Date(),
              comment: body.comment ?? null,
              updatedAt: new Date(),
            })
            .where(eq(approvalSteps.id, id));
          await recordAudit(tx, actorOf(req), {
            action: 'APPROVAL_DECISION',
            category: 'APPROVAL',
            entityType: 'approval_step',
            entityId: id,
            opportunityId: ar.opportunityId,
            changes: [
              { field: 'status', old: 'PENDING', new: body.decision },
              { field: 'kind', old: null, new: step.kind },
              ...(onBehalfOf.length
                ? [{ field: 'onBehalfOf', old: null, new: onBehalfOf.map((x) => x.userId) }]
                : []),
            ],
            reason: body.comment ?? null,
          });
          const opp = await lockOpportunity(tx, ar.opportunityId);
          const sheetPr = await tx
            .select({ priceRequestId: priceRequests.id })
            .from(priceRequests)
            .where(
              eq(
                priceRequests.id,
                opp.currentPriceRequestId ?? '00000000-0000-0000-0000-000000000000',
              ),
            );
          if (body.decision !== 'APPROVED') {
            await tx
              .update(approvalRequests)
              .set({ status: body.decision, resolvedAt: new Date(), updatedAt: new Date() })
              .where(eq(approvalRequests.id, ar.id));
            await tx
              .update(approvalSteps)
              .set({ status: 'CANCELLED' })
              .where(
                and(
                  eq(approvalSteps.approvalRequestId, ar.id),
                  eq(approvalSteps.status, 'PENDING'),
                ),
              );
            if (sheetPr[0]) {
              await tx
                .update(priceRequests)
                .set({
                  status: body.decision === 'REJECTED' ? 'REJECTED' : 'BUILDING',
                  currentHolderRole: 'CHINA_SALES',
                })
                .where(eq(priceRequests.id, sheetPr[0].priceRequestId));
            }
            return { requestStatus: body.decision };
          }
          const [{ n } = { n: 0 }] = await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(approvalSteps)
            .where(
              and(
                eq(approvalSteps.approvalRequestId, ar.id),
                sql`${approvalSteps.status} <> 'APPROVED'`,
              ),
            );
          if (n > 0) return { requestStatus: 'PENDING' };
          const expiresOn = addDays(req.today, ar.validDays);
          await tx
            .update(approvalRequests)
            .set({ status: 'APPROVED', resolvedAt: new Date(), expiresOn, updatedAt: new Date() })
            .where(eq(approvalRequests.id, ar.id));
          // P6-06: record approved margins, approver, date, version and expiry on the opportunity
          await tx
            .update(opportunities)
            .set({
              approvedNetMargin: ar.netMargin,
              approvedContractMargin: ar.contractMargin,
              approvedByUserId: auth.user.id,
              approvedAt: new Date(),
              approvalExpiresOn: expiresOn,
              currentApprovalRequestId: ar.id,
              updatedAt: new Date(),
            })
            .where(eq(opportunities.id, opp.id));
          if (sheetPr[0]) {
            await tx
              .update(priceRequests)
              .set({
                status: 'APPROVED',
                sheetApprovedAt: new Date(),
                currentHolderRole: 'ACCOUNT_MANAGER',
              })
              .where(eq(priceRequests.id, sheetPr[0].priceRequestId));
          }
          await recordAudit(tx, actorOf(req), {
            action: 'APPROVAL_DECISION',
            category: 'APPROVAL',
            entityType: 'approval_request',
            entityId: ar.id,
            opportunityId: opp.id,
            accountId: opp.accountId,
            changes: [
              { field: 'status', old: 'PENDING', new: 'APPROVED' },
              { field: 'expiresOn', old: null, new: expiresOn },
            ],
          });
          return { requestStatus: 'APPROVED', expiresOn };
        }),
      );
    },
  );

  app.post(
    '/approval-requests/:id/cancel',
    { config: { guard: { process: 'P6', action: 'write' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const { reason } = parse(z.object({ reason: z.string().trim().min(1) }), req.body);
      return ok(
        await db.transaction(async (tx) => {
          const [ar] = await tx
            .select()
            .from(approvalRequests)
            .where(eq(approvalRequests.id, id))
            .for('update');
          if (!ar) throw notFound();
          if (ar.status !== 'PENDING') throw ruleViolation([{ code: 'APPROVAL_NOT_PENDING' }]);
          await tx
            .update(approvalRequests)
            .set({ status: 'CANCELLED', resolvedAt: new Date() })
            .where(eq(approvalRequests.id, id));
          await tx
            .update(approvalSteps)
            .set({ status: 'CANCELLED' })
            .where(
              and(eq(approvalSteps.approvalRequestId, id), eq(approvalSteps.status, 'PENDING')),
            );
          await recordAudit(tx, actorOf(req), {
            action: 'APPROVAL_DECISION',
            category: 'APPROVAL',
            entityType: 'approval_request',
            entityId: id,
            opportunityId: ar.opportunityId,
            changes: [{ field: 'status', old: 'PENDING', new: 'CANCELLED' }],
            reason,
          });
          return { status: 'CANCELLED' };
        }),
      );
    },
  );
}
