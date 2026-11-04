import {
  AccountPlanSchema,
  AccountReviewSchema,
  edoTicketStats,
  handoffChecklistMissing,
  handoffOnTime,
  HandoffUpdateSchema,
  overdueQuarterlyReviews,
  renewalAlert,
  renewalDates,
} from '@wcrm/shared';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { diffFields, recordAudit } from '../../audit/record';
import type { DbOrTx } from '../../db/client';
import {
  accountPlans,
  accountReviews,
  accounts,
  contracts,
  handoffs,
  opportunities,
  opportunityContacts,
  renewals,
  stageHistory,
  tickets,
  users,
} from '../../db/schema/index';
import { notFound, ruleViolation } from '../../lib/errors';
import { actorOf, authOf, ok } from '../../lib/http';
import { parse } from '../../lib/validate';
import { moneyColumns } from '../../services/money';
import type { RulesContext } from '../../services/rulesContext';

/** Ensures a renewal row (T−90 / T−60) for every renewable signed contract (P10-03). */
export async function syncRenewals(db: DbOrTx, ctx: RulesContext): Promise<number> {
  const rows = await db
    .select({ id: contracts.id, endDate: contracts.endDate })
    .from(contracts)
    .where(
      and(
        eq(contracts.renewable, true),
        inArray(contracts.status, ['SIGNED', 'ACTIVE']),
        sql`${contracts.endDate} IS NOT NULL`,
      ),
    );
  let n = 0;
  for (const r of rows) {
    const d = renewalDates(r.endDate!, ctx.settings);
    const ins = await db
      .insert(renewals)
      .values({ contractId: r.id, endDate: r.endDate!, ...d })
      .onConflictDoNothing()
      .returning({ id: renewals.id });
    n += ins.length;
  }
  return n;
}

/** Creates the renewal opportunity (existing customer, stage 0) for a renewal row (P10-03). */
export async function createRenewalOpportunity(
  db: DbOrTx,
  renewalId: string,
  actor: Parameters<typeof recordAudit>[1],
  today: string,
): Promise<string> {
  const [r] = await db.select().from(renewals).where(eq(renewals.id, renewalId)).for('update');
  if (!r) throw notFound();
  if (r.renewalOpportunityId) return r.renewalOpportunityId;
  const [c] = await db.select().from(contracts).where(eq(contracts.id, r.contractId));
  const [src] = c!.opportunityId
    ? await db.select().from(opportunities).where(eq(opportunities.id, c!.opportunityId))
    : [];
  const [acc] = await db.select().from(accounts).where(eq(accounts.id, c!.accountId));
  const seq = await db.execute<{ n: string }>(
    sql`SELECT nextval('opportunity_code_seq')::text AS n`,
  );
  const [o] = await db
    .insert(opportunities)
    .values({
      code: `OPP-${today.slice(0, 4)}-${seq.rows[0]!.n.padStart(4, '0')}`,
      name: `Renovación — ${c!.title}`,
      accountId: c!.accountId,
      ownerId: src?.ownerId ?? acc!.ownerId,
      countryCode: acc!.countryCode,
      vertical: src?.vertical ?? acc!.vertical,
      billingEngine: c!.billingEngine ?? src?.billingEngine ?? 'C',
      origin: 'OTHER',
      amount: c!.amount,
      amountCurrency: c!.amountCurrency,
      amountUsd: c!.amountUsd,
      amountCny: c!.amountCny,
      amountClp: c!.amountClp,
      amountFxMonth: c!.amountFxMonth,
      amountFxProvisional: c!.amountFxProvisional,
      expectedCloseDate: r.endDate,
      firstContactDate: today,
      countsAsDigital: src?.countsAsDigital ?? false,
      isRenewal: true,
      forecastCategory: 'PIPELINE',
      createdBy: actor.userId,
    })
    .returning();
  await db.execute(sql`INSERT INTO opportunity_qualifications (opportunity_id) VALUES (${o!.id})`);
  if (src) {
    const cs = await db
      .select()
      .from(opportunityContacts)
      .where(eq(opportunityContacts.opportunityId, src.id));
    if (cs.length)
      await db.insert(opportunityContacts).values(cs.map((x) => ({ ...x, opportunityId: o!.id })));
  }
  await db.insert(stageHistory).values({
    opportunityId: o!.id,
    toStage: 0,
    toStatus: 'OPEN',
    changedBy: actor.userId,
    reason: 'Renovación T−90 (P10-03)',
  });
  await db
    .update(renewals)
    .set({ renewalOpportunityId: o!.id, status: 'OPPORTUNITY_CREATED', updatedAt: new Date() })
    .where(eq(renewals.id, renewalId));
  await recordAudit(db, actor, {
    action: 'CREATE',
    category: 'DATA',
    entityType: 'opportunity',
    entityId: o!.id,
    opportunityId: o!.id,
    accountId: o!.accountId,
    reason: 'renewal',
  });
  return o!.id;
}

export async function postsaleRoutes(app: FastifyInstance) {
  const { db, rules } = app.ctx;
  const idParam = z.object({ id: z.string().uuid() });

  // ---------- P9 hand-offs ----------
  app.get('/handoffs', { config: { guard: { process: 'P9', action: 'view' } } }, async (req) => {
    const rows = await db
      .select({
        h: handoffs,
        opportunityName: opportunities.name,
        accountName: accounts.name,
        stage: opportunities.stage,
      })
      .from(handoffs)
      .innerJoin(opportunities, eq(opportunities.id, handoffs.opportunityId))
      .innerJoin(accounts, eq(accounts.id, opportunities.accountId))
      .orderBy(desc(handoffs.createdAt));
    return ok(
      rows.map((r) => {
        const meetingOn = r.h.meetingAt ? r.h.meetingAt.toISOString().slice(0, 10) : null;
        return {
          ...r.h,
          opportunityName: r.opportunityName,
          accountName: r.accountName,
          stage: r.stage,
          checklistMissing: handoffChecklistMissing(r.h),
          meetingLate: Boolean(r.h.dueOn && meetingOn && meetingOn > r.h.dueOn),
          onTime: handoffOnTime({
            dueOn: r.h.dueOn,
            meetingOn,
            plannedStart: r.h.plannedStart,
            actualStart: r.h.actualStart,
          }),
          overdue: !meetingOn && r.h.dueOn !== null && r.h.dueOn < req.today,
        };
      }),
    );
  });

  app.patch(
    '/handoffs/:id',
    { config: { guard: { process: 'P9', action: 'write' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const body = parse(HandoffUpdateSchema, req.body);
      return ok(
        await db.transaction(async (tx) => {
          const [before] = await tx
            .select()
            .from(handoffs)
            .where(eq(handoffs.id, id))
            .for('update');
          if (!before) throw notFound();
          const [after] = await tx
            .update(handoffs)
            .set({ ...body, updatedAt: new Date(), rowVersion: before.rowVersion + 1 })
            .where(eq(handoffs.id, id))
            .returning();
          await recordAudit(tx, actorOf(req), {
            action: 'UPDATE',
            category: 'SCOPE',
            entityType: 'handoff',
            entityId: id,
            opportunityId: before.opportunityId,
            changes: diffFields(before, after!, Object.keys(body)),
          });
          return after;
        }),
      );
    },
  );

  // ---------- P10 account plans ----------
  app.get(
    '/accounts/:id/plans',
    { config: { guard: { process: 'P10', action: 'view' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      return ok(
        await db
          .select()
          .from(accountPlans)
          .where(eq(accountPlans.accountId, id))
          .orderBy(desc(accountPlans.year)),
      );
    },
  );

  app.post(
    '/accounts/:id/plans',
    { config: { guard: { process: 'P10', action: 'write' } } },
    async (req, reply) => {
      const { id } = parse(idParam, req.params);
      const body = parse(AccountPlanSchema, req.body);
      const ctx = await rules.get();
      const { target, targetCurrency, ...rest } = body;
      const values = {
        ...rest,
        ...moneyColumns('target', target ?? null, targetCurrency ?? null, req.today, ctx.fx),
        accountId: id,
        createdBy: authOf(req).user.id,
      };
      const row = await db.transaction(async (tx) => {
        const [p] = await tx
          .insert(accountPlans)
          .values(values)
          .onConflictDoUpdate({
            target: [accountPlans.accountId, accountPlans.year],
            set: { ...values, status: 'DRAFT', updatedAt: new Date() },
          })
          .returning();
        await recordAudit(tx, actorOf(req), {
          action: 'UPDATE',
          category: 'DATA',
          entityType: 'account_plan',
          entityId: p!.id,
          accountId: id,
          changes: [{ field: 'year', old: null, new: body.year }],
        });
        return p;
      });
      return reply.status(201).send(ok(row));
    },
  );

  app.post(
    '/account-plans/:id/approve',
    { config: { guard: { process: 'P10', action: 'approve' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      return ok(
        await db.transaction(async (tx) => {
          const [p] = await tx
            .update(accountPlans)
            .set({
              status: 'APPROVED',
              approvedBy: authOf(req).user.id,
              approvedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(accountPlans.id, id))
            .returning();
          if (!p) throw notFound();
          await recordAudit(tx, actorOf(req), {
            action: 'APPROVAL_DECISION',
            category: 'APPROVAL',
            entityType: 'account_plan',
            entityId: id,
            accountId: p.accountId,
            changes: [{ field: 'status', old: null, new: 'APPROVED' }],
          });
          return p;
        }),
      );
    },
  );

  // ---------- P10 reviews (quarterly + monthly eDo) ----------
  app.get(
    '/accounts/:id/reviews',
    { config: { guard: { process: 'P10', action: 'view' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      return ok(
        await db
          .select()
          .from(accountReviews)
          .where(eq(accountReviews.accountId, id))
          .orderBy(desc(accountReviews.periodStart)),
      );
    },
  );

  app.post(
    '/accounts/:id/reviews',
    { config: { guard: { process: 'P10', action: 'write' } } },
    async (req, reply) => {
      const { id } = parse(idParam, req.params);
      const body = parse(AccountReviewSchema, req.body);
      let stats = null;
      if (body.kind === 'EDO_MONTHLY') {
        const ts = await db
          .select({
            status: tickets.status,
            priority: tickets.priority,
            slaDueOn: tickets.slaDueOn,
            ballIn: tickets.ballIn,
          })
          .from(tickets)
          .where(eq(tickets.accountId, id));
        stats = edoTicketStats(ts, req.today);
      }
      const row = await db.transaction(async (tx) => {
        const [r] = await tx
          .insert(accountReviews)
          .values({
            ...body,
            actions: body.actions ?? null,
            accountId: id,
            edoTicketStats: stats,
            createdBy: authOf(req).user.id,
          })
          .returning();
        await recordAudit(tx, actorOf(req), {
          action: 'CREATE',
          category: 'DATA',
          entityType: 'account_review',
          entityId: r!.id,
          accountId: id,
          changes: [{ field: 'kind', old: null, new: body.kind }],
        });
        return r;
      });
      return reply.status(201).send(ok(row));
    },
  );

  app.get(
    '/reviews/overdue',
    { config: { guard: { process: 'P10', action: 'view' } } },
    async (req) => {
      const keys = await db
        .select({ id: accounts.id, name: accounts.name })
        .from(accounts)
        .where(and(eq(accounts.isKeyAccount, true), sql`${accounts.archivedAt} IS NULL`));
      const rv = await db
        .select({
          accountId: accountReviews.accountId,
          kind: accountReviews.kind,
          periodStart: accountReviews.periodStart,
        })
        .from(accountReviews);
      return ok(
        overdueQuarterlyReviews(
          keys.map((k) => k.id),
          rv,
          req.today,
        ).map((o) => ({
          ...o,
          accountName: keys.find((k) => k.id === o.accountId)?.name,
        })),
      );
    },
  );

  // ---------- P10 renewals ----------
  app.get('/renewals', { config: { guard: { process: 'P10', action: 'view' } } }, async (req) => {
    const ctx = await rules.get();
    await syncRenewals(db, ctx);
    const rows = await db
      .select({
        r: renewals,
        contractTitle: contracts.title,
        contractType: contracts.type,
        billingEngine: contracts.billingEngine,
        amount: contracts.amount,
        currency: contracts.amountCurrency,
        accountName: accounts.name,
        renewalStage: opportunities.stage,
        renewalStatus: opportunities.status,
        ownerName: users.fullName,
      })
      .from(renewals)
      .innerJoin(contracts, eq(contracts.id, renewals.contractId))
      .innerJoin(accounts, eq(accounts.id, contracts.accountId))
      .leftJoin(opportunities, eq(opportunities.id, renewals.renewalOpportunityId))
      .leftJoin(users, eq(users.id, opportunities.ownerId))
      .orderBy(asc(renewals.endDate));
    return ok(
      rows.map((x) => ({
        ...x.r,
        contractTitle: x.contractTitle,
        contractType: x.contractType,
        billingEngine: x.billingEngine,
        amount: x.amount,
        currency: x.currency,
        accountName: x.accountName,
        renewalStage: x.renewalStage,
        ownerName: x.ownerName,
        alert: renewalAlert(
          {
            createOn: x.r.createOn,
            quoteBy: x.r.quoteBy,
            hasOpportunity: Boolean(x.r.renewalOpportunityId),
            quoted: Boolean(x.r.quotedAt) || (x.renewalStage ?? 0) >= 5,
            closed:
              ['RENEWED', 'NOT_RENEWED'].includes(x.r.status) ||
              (x.renewalStatus !== null && x.renewalStatus !== 'OPEN'),
          },
          req.today,
        ),
      })),
    );
  });

  app.post(
    '/renewals/:id/create-opportunity',
    { config: { guard: { process: 'P10', action: 'write' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const [r] = await db.select().from(renewals).where(eq(renewals.id, id));
      if (!r) throw notFound();
      if (r.status === 'RENEWED' || r.status === 'NOT_RENEWED')
        throw ruleViolation([{ code: 'STATUS_INVALID', params: { status: r.status } }]);
      const oppId = await db.transaction((tx) =>
        createRenewalOpportunity(tx, id, actorOf(req), req.today),
      );
      return ok({ opportunityId: oppId });
    },
  );
}
