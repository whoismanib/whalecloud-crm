import {
  addBusinessDays,
  addDays,
  canAccept,
  canSendToFinance,
  CollectionCompleteSchema,
  D,
  ESCALATION_RESPONSIBILITY,
  escalationSchedule,
  escalationStatus,
  EvidenceCreateSchema,
  InvoiceCreateSchema,
  money,
  PaymentCreateSchema,
  recognitionDate,
  signatureFailures,
  type CollectionStep,
  type UserRole,
} from '@wcrm/shared';
import { and, asc, desc, eq, inArray, lte, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recordAudit } from '../../audit/record';
import type { DbOrTx } from '../../db/client';
import {
  accounts,
  attachments,
  collectionActions,
  contracts,
  invoices,
  milestoneBillingLines,
  milestoneEvidence,
  milestones,
  opportunities,
  payments,
  userRoles,
  users,
} from '../../db/schema/index';
import { AppError, assertRules, notFound, ruleViolation } from '../../lib/errors';
import { actorOf, authOf, ok } from '../../lib/http';
import { parse } from '../../lib/validate';
import { moneyColumns } from '../../services/money';
import { recomputeDerivedStage } from '../../services/opportunities';
import { linkAttachment } from '../contracts/routes';

type MilestoneRow = typeof milestones.$inferSelect;

async function lockMilestone(tx: DbOrTx, id: string): Promise<MilestoneRow> {
  const [m] = await tx.select().from(milestones).where(eq(milestones.id, id)).for('update');
  if (!m) throw notFound();
  return m;
}

async function accountOfMilestone(tx: DbOrTx, m: MilestoneRow) {
  const [r] = await tx
    .select({ account: accounts })
    .from(contracts)
    .innerJoin(accounts, eq(accounts.id, contracts.accountId))
    .where(eq(contracts.id, m.contractId));
  return r!.account;
}

async function evidenceOf(tx: DbOrTx, milestoneId: string) {
  return tx
    .select({
      e: milestoneEvidence,
      standardName: attachments.standardName,
      url: attachments.externalUrl,
    })
    .from(milestoneEvidence)
    .innerJoin(attachments, eq(attachments.id, milestoneEvidence.attachmentId))
    .where(eq(milestoneEvidence.milestoneId, milestoneId));
}

async function firstUserWithRole(tx: DbOrTx, role: UserRole): Promise<string | null> {
  const [u] = await tx
    .select({ id: users.id })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .where(and(eq(userRoles.role, role), eq(users.isActive, true)))
    .orderBy(asc(users.createdAt))
    .limit(1);
  return u?.id ?? null;
}

export async function billingRoutes(app: FastifyInstance) {
  const { db, rules } = app.ctx;
  const idParam = z.object({ id: z.string().uuid() });

  app.get('/milestones', { config: { guard: { process: 'P8', action: 'view' } } }, async (req) => {
    const q = parse(
      z.object({
        opportunityId: z.string().uuid().optional(),
        contractId: z.string().uuid().optional(),
      }),
      req.query,
    );
    const where: SQL[] = [];
    if (q.opportunityId) where.push(eq(milestones.opportunityId, q.opportunityId));
    if (q.contractId) where.push(eq(milestones.contractId, q.contractId));
    const ms = await db
      .select()
      .from(milestones)
      .where(where.length ? and(...where) : undefined)
      .orderBy(asc(milestones.contractId), asc(milestones.seq));
    if (!ms.length) return ok([]);
    const ids = ms.map((m) => m.id);
    const [ev, lines, invs] = await Promise.all([
      db
        .select({
          e: milestoneEvidence,
          standardName: attachments.standardName,
          url: attachments.externalUrl,
        })
        .from(milestoneEvidence)
        .innerJoin(attachments, eq(attachments.id, milestoneEvidence.attachmentId))
        .where(inArray(milestoneEvidence.milestoneId, ids)),
      db
        .select()
        .from(milestoneBillingLines)
        .where(inArray(milestoneBillingLines.milestoneId, ids)),
      db.select().from(invoices).where(inArray(invoices.milestoneId, ids)),
    ]);
    const ctx = await rules.get();
    return ok(
      ms.map((m) => ({
        ...m,
        evidence: ev
          .filter((e) => e.e.milestoneId === m.id)
          .map((e) => ({ ...e.e, standardName: e.standardName, url: e.url })),
        billingLines: lines.filter((l) => l.milestoneId === m.id),
        invoices: invs
          .filter((i) => i.milestoneId === m.id)
          .map((i) => ({
            ...i,
            escalation: escalationStatus(
              { dueOn: i.dueOn, balance: i.balance },
              req.today,
              ctx.settings,
            ),
          })),
      })),
    );
  });

  /** P8-01: deliverable ready → AC SLA 10 business days. */
  app.post(
    '/milestones/:id/ready',
    { config: { guard: { process: 'P8', action: 'write', actionRole: 'P8.milestone.ready' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const ctx = await rules.get();
      return ok(
        await db.transaction(async (tx) => {
          const m = await lockMilestone(tx, id);
          if (m.status !== 'PLANNED')
            throw ruleViolation([{ code: 'STATUS_INVALID', params: { status: m.status } }]);
          const [after] = await tx
            .update(milestones)
            .set({
              status: 'READY',
              readyAt: new Date(),
              acDueOn: addBusinessDays(
                req.today,
                ctx.settings['sla.businessDays'].P8_ACCEPTANCE,
                ctx.calendars.CL!,
              ),
              updatedAt: new Date(),
            })
            .where(eq(milestones.id, id))
            .returning();
          await recordAudit(tx, actorOf(req), {
            action: 'UPDATE',
            category: 'BILLING',
            entityType: 'milestone',
            entityId: id,
            opportunityId: m.opportunityId,
            changes: [{ field: 'status', old: m.status, new: 'READY' }],
          });
          return after;
        }),
      );
    },
  );

  /** P8-02: acceptance evidence (link to the repository with standard name). */
  app.post(
    '/milestones/:id/evidence',
    { config: { guard: { process: 'P8', action: 'write', actionRole: 'P8.evidence.write' } } },
    async (req, reply) => {
      const { id } = parse(idParam, req.params);
      const body = parse(EvidenceCreateSchema, req.body);
      const row = await db.transaction(async (tx) => {
        const m = await lockMilestone(tx, id);
        const account = await accountOfMilestone(tx, m);
        assertRules(signatureFailures(body, account));
        const att = await linkAttachment(tx, {
          url: body.url,
          standardName: body.standardName,
          entityType: 'milestone',
          entityId: id,
          accountId: account.id,
          opportunityId: m.opportunityId,
          contractId: m.contractId,
          createdBy: authOf(req).user.id,
        });
        const [ev] = await tx
          .insert(milestoneEvidence)
          .values({
            milestoneId: id,
            evidenceType: body.evidenceType,
            attachmentId: att.id,
            receivedOn: body.receivedOn,
            signatureType: body.signatureType ?? null,
            notes: body.notes ?? null,
            createdBy: authOf(req).user.id,
          })
          .returning();
        const patch: Partial<typeof milestones.$inferInsert> = { updatedAt: new Date() };
        if (body.evidenceType === 'ACCEPTANCE_EMAIL')
          patch.acceptanceEmailAt = new Date(`${body.receivedOn}T12:00:00Z`);
        if (body.evidenceType === 'SIGNED_AC') patch.acSignedAt = body.receivedOn;
        if (body.evidenceType === 'RECEPTION') patch.receptionAt = body.receivedOn;
        await tx.update(milestones).set(patch).where(eq(milestones.id, id));
        await recordAudit(tx, actorOf(req), {
          action: 'FILE_UPLOAD',
          category: 'BILLING',
          entityType: 'milestone_evidence',
          entityId: ev!.id,
          opportunityId: m.opportunityId,
          accountId: account.id,
          changes: [{ field: body.evidenceType, old: null, new: body.standardName }],
        });
        return ev!;
      });
      return reply.status(201).send(ok(row));
    },
  );

  /** P8-02/03: accept when the engine's evidence is complete; derives stage 9 (CORE-06). */
  app.post(
    '/milestones/:id/accept',
    { config: { guard: { process: 'P8', action: 'write' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      return ok(
        await db.transaction(async (tx) => {
          const m = await lockMilestone(tx, id);
          if (m.status !== 'READY')
            throw ruleViolation([{ code: 'STATUS_INVALID', params: { status: m.status } }]);
          const account = await accountOfMilestone(tx, m);
          const ev = await evidenceOf(tx, id);
          assertRules(
            canAccept(
              m.billingEngine,
              ev.map((e) => e.e),
              account,
            ),
          );
          const dates = ev
            .map((e) => e.e.receivedOn)
            .filter((d): d is string => Boolean(d))
            .sort();
          const recognizedOn =
            recognitionDate(m.acSignedAt, m.receptionAt) ??
            m.receptionAt ??
            dates.at(-1) ??
            req.today;
          const [after] = await tx
            .update(milestones)
            .set({ status: 'ACCEPTED', recognizedOn, updatedAt: new Date() })
            .where(eq(milestones.id, id))
            .returning();
          await recordAudit(tx, actorOf(req), {
            action: 'UPDATE',
            category: 'BILLING',
            entityType: 'milestone',
            entityId: id,
            opportunityId: m.opportunityId,
            changes: [
              { field: 'status', old: m.status, new: 'ACCEPTED' },
              { field: 'recognizedOn', old: null, new: recognizedOn },
            ],
          });
          await recomputeDerivedStage(tx, m.opportunityId, actorOf(req));
          return after;
        }),
      );
    },
  );

  /** P8-04: package to China Finance; invoice SLA 1 business day (CN calendar). */
  app.post(
    '/milestones/:id/send-to-finance',
    { config: { guard: { process: 'P8', action: 'write', actionRole: 'P8.sendToFinance' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const ctx = await rules.get();
      return ok(
        await db.transaction(async (tx) => {
          const m = await lockMilestone(tx, id);
          const account = await accountOfMilestone(tx, m);
          const ev = await evidenceOf(tx, id);
          assertRules(
            canSendToFinance(
              m,
              ev.map((e) => e.e),
              account,
            ),
          );
          const [after] = await tx
            .update(milestones)
            .set({
              status: 'SENT_TO_FINANCE',
              sentToFinanceAt: new Date(),
              invoiceDueOn: addBusinessDays(
                req.today,
                ctx.settings['sla.businessDays'].P8_INVOICE,
                ctx.calendars.CN!,
              ),
              updatedAt: new Date(),
            })
            .where(eq(milestones.id, id))
            .returning();
          await recordAudit(tx, actorOf(req), {
            action: 'UPDATE',
            category: 'BILLING',
            entityType: 'milestone',
            entityId: id,
            opportunityId: m.opportunityId,
            changes: [{ field: 'status', old: m.status, new: 'SENT_TO_FINANCE' }],
          });
          return after;
        }),
      );
    },
  );

  /** P8-05: China Finance registers the invoice; schedules the −10/+1/+7/+15/+30 escalation. */
  app.post(
    '/milestone-billing-lines/:id/invoices',
    { config: { guard: { process: 'P8', action: 'write', actionRole: 'P8.invoice.write' } } },
    async (req, reply) => {
      const { id } = parse(idParam, req.params);
      const body = parse(InvoiceCreateSchema, req.body);
      const ctx = await rules.get();
      const row = await db.transaction(async (tx) => {
        const [line] = await tx
          .select()
          .from(milestoneBillingLines)
          .where(eq(milestoneBillingLines.id, id));
        if (!line) throw notFound();
        const m = await lockMilestone(tx, line.milestoneId);
        if (!['SENT_TO_FINANCE', 'INVOICED', 'PARTIALLY_PAID'].includes(m.status)) {
          throw ruleViolation([
            { code: 'MILESTONE_NOT_SENT_TO_FINANCE', params: { status: m.status } },
          ]);
        }
        const [dup] = await tx
          .select({ id: invoices.id })
          .from(invoices)
          .where(eq(invoices.billingLineId, id));
        if (dup) throw ruleViolation([{ code: 'BILLING_LINE_ALREADY_INVOICED' }]);
        const account = await accountOfMilestone(tx, m);
        const term = body.paymentTermDays ?? ctx.settings['invoices.defaultPaymentTermDays'];
        const dueOn = addDays(body.issuedOn, term);
        const [inv] = await tx
          .insert(invoices)
          .values({
            billingLineId: id,
            milestoneId: m.id,
            accountId: account.id,
            billingEntityId: line.billingEntityId,
            number: body.number,
            issuedOn: body.issuedOn,
            ...moneyColumns('amount', body.amount, body.currency, body.issuedOn, ctx.fx),
            paymentTermDays: term,
            dueOn,
            balance: body.amount,
            createdBy: authOf(req).user.id,
          })
          .returning();
        for (const e of escalationSchedule(dueOn, ctx.settings)) {
          const role = e.responsibleRoles[0]!;
          await tx.insert(collectionActions).values({
            invoiceId: inv!.id,
            step: e.step,
            scheduledOn: e.scheduledOn,
            responsibleRole: role,
            assigneeUserId: await firstUserWithRole(tx, role),
            notifiedRoles: [...e.responsibleRoles.slice(1), ...e.notifyRoles],
            jobKey: `${inv!.id}:${e.step}`,
          });
        }
        const lines = await tx
          .select({ id: milestoneBillingLines.id })
          .from(milestoneBillingLines)
          .where(eq(milestoneBillingLines.milestoneId, m.id));
        const invoiced = await tx
          .select({ id: invoices.id })
          .from(invoices)
          .where(eq(invoices.milestoneId, m.id));
        if (invoiced.length >= lines.length && m.status === 'SENT_TO_FINANCE') {
          await tx
            .update(milestones)
            .set({ status: 'INVOICED', updatedAt: new Date() })
            .where(eq(milestones.id, m.id));
        }
        await recordAudit(tx, actorOf(req), {
          action: 'CREATE',
          category: 'BILLING',
          entityType: 'invoice',
          entityId: inv!.id,
          opportunityId: m.opportunityId,
          accountId: account.id,
          changes: [
            { field: 'number', old: null, new: body.number },
            { field: 'amount', old: null, new: `${body.amount} ${body.currency}` },
            { field: 'dueOn', old: null, new: dueOn },
          ],
        });
        await recomputeDerivedStage(tx, m.opportunityId, actorOf(req));
        return inv!;
      });
      return reply.status(201).send(ok(row));
    },
  );

  app.get('/invoices', { config: { guard: { process: 'P8', action: 'view' } } }, async (req) => {
    const ctx = await rules.get();
    const rows = await db
      .select({
        inv: invoices,
        accountName: accounts.name,
        milestoneName: milestones.name,
        opportunityId: milestones.opportunityId,
        opportunityName: opportunities.name,
      })
      .from(invoices)
      .innerJoin(accounts, eq(accounts.id, invoices.accountId))
      .innerJoin(milestones, eq(milestones.id, invoices.milestoneId))
      .innerJoin(opportunities, eq(opportunities.id, milestones.opportunityId))
      .orderBy(asc(invoices.dueOn));
    return ok(
      rows.map((r) => ({
        ...r.inv,
        accountName: r.accountName,
        milestoneName: r.milestoneName,
        opportunityId: r.opportunityId,
        opportunityName: r.opportunityName,
        escalation: escalationStatus(
          { dueOn: r.inv.dueOn, balance: r.inv.balance },
          req.today,
          ctx.settings,
        ),
      })),
    );
  });

  /** P8-07: total or partial payment; balance 0 cancels pending collection actions. */
  app.post(
    '/invoices/:id/payments',
    { config: { guard: { process: 'P8', action: 'write', actionRole: 'P8.payment.write' } } },
    async (req, reply) => {
      const { id } = parse(idParam, req.params);
      const body = parse(PaymentCreateSchema, req.body);
      const ctx = await rules.get();
      const row = await db.transaction(async (tx) => {
        const [inv] = await tx.select().from(invoices).where(eq(invoices.id, id)).for('update');
        if (!inv) throw notFound();
        if (body.currency !== inv.amountCurrency) {
          throw ruleViolation([
            { code: 'PAYMENT_CURRENCY_MISMATCH', params: { invoiceCurrency: inv.amountCurrency } },
          ]);
        }
        if (D(body.amount).gt(D(inv.balance))) {
          throw ruleViolation([
            { code: 'PAYMENT_EXCEEDS_BALANCE', params: { balance: inv.balance } },
          ]);
        }
        const [p] = await tx
          .insert(payments)
          .values({
            invoiceId: id,
            paidOn: body.paidOn,
            ...moneyColumns('amount', body.amount, body.currency, body.paidOn, ctx.fx),
            reference: body.reference ?? null,
            createdBy: authOf(req).user.id,
          })
          .returning();
        const balance = money(D(inv.balance).minus(D(body.amount)));
        const paid = D(balance).lte(0);
        await tx
          .update(invoices)
          .set({ balance, status: paid ? 'PAID' : 'PARTIALLY_PAID', updatedAt: new Date() })
          .where(eq(invoices.id, id));
        if (paid) {
          await tx
            .update(collectionActions)
            .set({ status: 'CANCELLED', outcome: 'PAID', updatedAt: new Date() })
            .where(
              and(eq(collectionActions.invoiceId, id), eq(collectionActions.status, 'PENDING')),
            );
        }
        const m = await lockMilestone(tx, inv.milestoneId);
        const lines = await tx
          .select({ id: milestoneBillingLines.id })
          .from(milestoneBillingLines)
          .where(eq(milestoneBillingLines.milestoneId, m.id));
        const invs = await tx
          .select({ balance: invoices.balance })
          .from(invoices)
          .where(eq(invoices.milestoneId, m.id));
        const allPaid = invs.length >= lines.length && invs.every((i) => D(i.balance).lte(0));
        await tx
          .update(milestones)
          .set({ status: allPaid ? 'PAID' : 'PARTIALLY_PAID', updatedAt: new Date() })
          .where(eq(milestones.id, m.id));
        await recordAudit(tx, actorOf(req), {
          action: 'CREATE',
          category: 'BILLING',
          entityType: 'payment',
          entityId: p!.id,
          opportunityId: m.opportunityId,
          accountId: inv.accountId,
          changes: [
            { field: 'amount', old: null, new: `${body.amount} ${body.currency}` },
            { field: 'balance', old: inv.balance, new: balance },
          ],
        });
        await recomputeDerivedStage(tx, m.opportunityId, actorOf(req));
        return { ...p!, invoiceBalance: balance };
      });
      return reply.status(201).send(ok(row));
    },
  );

  app.get(
    '/collection-actions',
    { config: { guard: { process: 'P8', action: 'view' } } },
    async (req) => {
      const q = parse(
        z.object({
          status: z.string().optional(),
          due: z.string().optional(),
          mine: z.string().optional(),
        }),
        req.query,
      );
      const auth = authOf(req);
      const where: SQL[] = [];
      if (q.status) where.push(sql`${collectionActions.status}::text = ${q.status}`);
      if (q.due === 'true') where.push(lte(collectionActions.scheduledOn, req.today));
      if (q.mine === 'true') {
        where.push(
          sql`${collectionActions.responsibleRole}::text IN (${sql.join(
            auth.roles.map((r) => sql`${r}`),
            sql`, `,
          )})`,
        );
      }
      const rows = await db
        .select({
          a: collectionActions,
          invoiceNumber: invoices.number,
          invoiceDueOn: invoices.dueOn,
          balance: invoices.balance,
          currency: invoices.amountCurrency,
          accountName: accounts.name,
          assigneeName: users.fullName,
        })
        .from(collectionActions)
        .innerJoin(invoices, eq(invoices.id, collectionActions.invoiceId))
        .innerJoin(accounts, eq(accounts.id, invoices.accountId))
        .leftJoin(users, eq(users.id, collectionActions.assigneeUserId))
        .where(where.length ? and(...where) : undefined)
        .orderBy(asc(collectionActions.scheduledOn))
        .limit(500);
      return ok(
        rows.map((r) => ({
          ...r.a,
          invoiceNumber: r.invoiceNumber,
          invoiceDueOn: r.invoiceDueOn,
          balance: r.balance,
          currency: r.currency,
          accountName: r.accountName,
          assigneeName: r.assigneeName,
          due: r.a.scheduledOn <= req.today,
        })),
      );
    },
  );

  /** The responsible role of the step records the outcome (P8-06, `P8.collection.action`). */
  app.post(
    '/collection-actions/:id/complete',
    { config: { guard: { process: 'P8', action: 'view', extra: 'responsible role of the step' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const body = parse(CollectionCompleteSchema, req.body);
      const auth = authOf(req);
      return ok(
        await db.transaction(async (tx) => {
          const [a] = await tx
            .select()
            .from(collectionActions)
            .where(eq(collectionActions.id, id))
            .for('update');
          if (!a) throw notFound();
          const allowed = ESCALATION_RESPONSIBILITY[a.step as CollectionStep].responsibleRoles;
          if (!auth.roles.some((r) => allowed.includes(r))) throw new AppError(403, 'FORBIDDEN');
          if (a.status !== 'PENDING')
            throw ruleViolation([{ code: 'STATUS_INVALID', params: { status: a.status } }]);
          if (a.scheduledOn > req.today)
            throw ruleViolation([
              { code: 'COLLECTION_NOT_DUE', params: { scheduledOn: a.scheduledOn } },
            ]);
          const [after] = await tx
            .update(collectionActions)
            .set({
              status: 'DONE',
              doneAt: new Date(),
              doneBy: auth.user.id,
              outcome: body.outcome,
              updatedAt: new Date(),
            })
            .where(eq(collectionActions.id, id))
            .returning();
          const [inv] = await tx.select().from(invoices).where(eq(invoices.id, a.invoiceId));
          const [m] = await tx.select().from(milestones).where(eq(milestones.id, inv!.milestoneId));
          await recordAudit(tx, actorOf(req), {
            action: 'UPDATE',
            category: 'COLLECTION',
            entityType: 'collection_action',
            entityId: id,
            opportunityId: m?.opportunityId ?? null,
            accountId: inv!.accountId,
            changes: [
              { field: 'status', old: 'PENDING', new: 'DONE' },
              { field: 'step', old: null, new: a.step },
            ],
            reason: body.outcome,
          });
          return after;
        }),
      );
    },
  );

  app.get('/payments', { config: { guard: { process: 'P8', action: 'view' } } }, async () =>
    ok(await db.select().from(payments).orderBy(desc(payments.paidOn)).limit(500)),
  );
}
