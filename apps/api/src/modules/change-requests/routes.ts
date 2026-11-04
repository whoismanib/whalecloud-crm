import {
  canStartWork,
  ChangeRequestCreateSchema,
  CrExceptionSchema,
  CrLinesSchema,
  CrPoSchema,
  CrReceptionSchema,
  quoteCr,
  RateCardSchema,
  type Currency,
} from '@wcrm/shared';
import { and, asc, desc, eq, isNull, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recordAudit } from '../../audit/record';
import type { DbOrTx } from '../../db/client';
import {
  accounts,
  changeRequestLines,
  changeRequests,
  contracts,
  milestoneBillingLines,
  milestoneEvidence,
  milestones,
  opportunities,
  rateCards,
  stageHistory,
} from '../../db/schema/index';
import { assertRules, notFound, ruleViolation } from '../../lib/errors';
import { actorOf, authOf, ok } from '../../lib/http';
import { parse } from '../../lib/validate';
import { moneyColumns } from '../../services/money';
import { linkAttachment } from '../contracts/routes';

type CrRow = typeof changeRequests.$inferSelect;

async function lockCr(tx: DbOrTx, id: string): Promise<CrRow> {
  const [cr] = await tx
    .select()
    .from(changeRequests)
    .where(eq(changeRequests.id, id))
    .for('update');
  if (!cr) throw notFound();
  return cr;
}

/** P11: CRs quoted with the per-profile rate card; no work without PO unless CM exception. */
export async function changeRequestRoutes(app: FastifyInstance) {
  const { db, rules } = app.ctx;
  const idParam = z.object({ id: z.string().uuid() });

  // ---------- rate cards (P11-05) ----------
  app.get('/rate-cards', { config: { guard: { process: 'P11', action: 'view' } } }, async () =>
    ok(
      await db
        .select({ r: rateCards, accountName: accounts.name, contractTitle: contracts.title })
        .from(rateCards)
        .leftJoin(accounts, eq(accounts.id, rateCards.accountId))
        .leftJoin(contracts, eq(contracts.id, rateCards.contractId))
        .orderBy(asc(rateCards.profile), desc(rateCards.validFrom))
        .then((rows) =>
          rows.map((x) => ({ ...x.r, accountName: x.accountName, contractTitle: x.contractTitle })),
        ),
    ),
  );

  app.post(
    '/rate-cards',
    { config: { guard: { process: 'P11', action: 'write' } } },
    async (req, reply) => {
      const body = parse(RateCardSchema, req.body);
      const row = await db.transaction(async (tx) => {
        const [r] = await tx
          .insert(rateCards)
          .values({
            ...body,
            accountId: body.accountId ?? null,
            contractId: body.contractId ?? null,
            validTo: body.validTo ?? null,
            createdBy: authOf(req).user.id,
          })
          .returning();
        await recordAudit(tx, actorOf(req), {
          action: 'CREATE',
          category: 'PRICE',
          entityType: 'rate_card',
          entityId: r!.id,
          accountId: r!.accountId,
          changes: [
            { field: 'rate', old: null, new: `${body.profile} ${body.rate} ${body.currency}` },
          ],
        });
        return r;
      });
      return reply.status(201).send(ok(row));
    },
  );

  // ---------- change requests ----------
  app.get(
    '/change-requests',
    { config: { guard: { process: 'P11', action: 'view' } } },
    async () => {
      const rows = await db
        .select({ cr: changeRequests, accountName: accounts.name, parentTitle: contracts.title })
        .from(changeRequests)
        .innerJoin(accounts, eq(accounts.id, changeRequests.accountId))
        .innerJoin(contracts, eq(contracts.id, changeRequests.parentContractId))
        .orderBy(desc(changeRequests.createdAt));
      return ok(
        rows.map((r) => ({ ...r.cr, accountName: r.accountName, parentTitle: r.parentTitle })),
      );
    },
  );

  app.get(
    '/change-requests/:id',
    { config: { guard: { process: 'P11', action: 'view' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const [cr] = await db.select().from(changeRequests).where(eq(changeRequests.id, id));
      if (!cr) throw notFound();
      const lines = await db
        .select()
        .from(changeRequestLines)
        .where(eq(changeRequestLines.changeRequestId, id));
      return ok({ ...cr, lines, startWorkCheck: canStartWork(cr, req.today) });
    },
  );

  app.post(
    '/change-requests',
    { config: { guard: { process: 'P11', action: 'write' } } },
    async (req, reply) => {
      const body = parse(ChangeRequestCreateSchema, req.body);
      const row = await db.transaction(async (tx) => {
        const [parent] = await tx
          .select()
          .from(contracts)
          .where(eq(contracts.id, body.parentContractId));
        if (!parent) throw notFound();
        const [acc] = await tx.select().from(accounts).where(eq(accounts.id, parent.accountId));
        if (acc?.newWorkSuspended) throw ruleViolation([{ code: 'ACCOUNT_SUSPENDED' }]);
        const seq = await tx.execute<{ n: string }>(
          sql`SELECT nextval('change_request_code_seq')::text AS n`,
        );
        const [cr] = await tx
          .insert(changeRequests)
          .values({
            code: `CR-${req.today.slice(0, 4)}-${seq.rows[0]!.n.padStart(4, '0')}`,
            accountId: parent.accountId,
            parentContractId: parent.id,
            title: body.title,
            description: body.description ?? null,
            createdBy: authOf(req).user.id,
          })
          .returning();
        await recordAudit(tx, actorOf(req), {
          action: 'CREATE',
          category: 'SCOPE',
          entityType: 'change_request',
          entityId: cr!.id,
          accountId: cr!.accountId,
          changes: [{ field: 'title', old: null, new: body.title }],
        });
        return cr;
      });
      return reply.status(201).send(ok(row));
    },
  );

  /** P11-01: lines priced with the rate card valid today (contract › account › global). */
  app.put(
    '/change-requests/:id/lines',
    { config: { guard: { process: 'P11', action: 'write' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const body = parse(CrLinesSchema, req.body);
      const ctx = await rules.get();
      return ok(
        await db.transaction(async (tx) => {
          const cr = await lockCr(tx, id);
          if (!['DRAFT', 'QUOTED'].includes(cr.status))
            throw ruleViolation([{ code: 'STATUS_INVALID', params: { status: cr.status } }]);
          const cards = await tx
            .select()
            .from(rateCards)
            .where(
              or(
                eq(rateCards.contractId, cr.parentContractId),
                and(eq(rateCards.accountId, cr.accountId), isNull(rateCards.contractId)),
                and(isNull(rateCards.accountId), isNull(rateCards.contractId)),
              ),
            );
          // contract-specific cards first, then account, then global
          const ordered = [
            ...cards.filter((c) => c.contractId),
            ...cards.filter((c) => !c.contractId && c.accountId),
            ...cards.filter((c) => !c.contractId && !c.accountId),
          ];
          const pick = body.map((l) => {
            const scoped = ['contract', 'account', 'global'].map((scope) =>
              ordered.filter((c) =>
                scope === 'contract'
                  ? c.contractId
                  : scope === 'account'
                    ? !c.contractId && c.accountId
                    : !c.contractId && !c.accountId,
              ),
            );
            const tier = scoped.find((s) => quoteCr([l], s, req.today).failures.length === 0) ?? [];
            return { line: l, cards: tier };
          });
          const quotes = pick.map((p) => quoteCr([p.line], p.cards, req.today));
          const failures = quotes.flatMap((q) => q.failures);
          assertRules(failures);
          const currencies = new Set(quotes.map((q) => q.currency));
          if (currencies.size > 1) throw ruleViolation([{ code: 'RATE_CARD_CURRENCY_MIX' }]);
          const total = quotes.reduce((a, q) => a + Number(q.total), 0).toFixed(2);
          const currency = quotes[0]!.currency as Currency;
          await tx.delete(changeRequestLines).where(eq(changeRequestLines.changeRequestId, id));
          await tx.insert(changeRequestLines).values(
            quotes.map((q) => ({
              changeRequestId: id,
              profile: q.lines[0]!.profile,
              hours: q.lines[0]!.hours,
              rate: q.lines[0]!.rate!,
              amount: q.lines[0]!.amount!,
              rateCardId: q.lines[0]!.rateCardId,
            })),
          );
          const [after] = await tx
            .update(changeRequests)
            .set({
              ...moneyColumns('amount', total, currency, req.today, ctx.fx),
              status: 'QUOTED',
              updatedAt: new Date(),
            })
            .where(eq(changeRequests.id, id))
            .returning();
          await recordAudit(tx, actorOf(req), {
            action: 'UPDATE',
            category: 'PRICE',
            entityType: 'change_request',
            entityId: id,
            accountId: cr.accountId,
            changes: [{ field: 'amount', old: cr.amount, new: `${total} ${currency}` }],
          });
          return after;
        }),
      );
    },
  );

  /** Client PO: creates the OC contract under the parent and the engine-B opportunity (won). */
  app.post(
    '/change-requests/:id/po',
    { config: { guard: { process: 'P11', action: 'write' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const body = parse(CrPoSchema, req.body);
      const ctx = await rules.get();
      const auth = authOf(req);
      return ok(
        await db.transaction(async (tx) => {
          const cr = await lockCr(tx, id);
          if (!['QUOTED', 'IN_PROGRESS'].includes(cr.status) || cr.poContractId) {
            throw ruleViolation([{ code: 'STATUS_INVALID', params: { status: cr.status } }]);
          }
          const [parent] = await tx
            .select()
            .from(contracts)
            .where(eq(contracts.id, cr.parentContractId));
          const [acc] = await tx.select().from(accounts).where(eq(accounts.id, cr.accountId));
          const seq = await tx.execute<{ n: string }>(
            sql`SELECT nextval('opportunity_code_seq')::text AS n`,
          );
          const [opp] = await tx
            .insert(opportunities)
            .values({
              code: `OPP-${req.today.slice(0, 4)}-${seq.rows[0]!.n.padStart(4, '0')}`,
              name: `${cr.code} — ${cr.title}`,
              accountId: cr.accountId,
              ownerId: auth.user.id,
              countryCode: acc!.countryCode,
              vertical: acc!.vertical,
              billingEngine: 'B',
              origin: 'OTHER',
              stage: 7,
              ...moneyColumns('amount', cr.amount, cr.amountCurrency, body.poReceivedOn, ctx.fx),
              expectedCloseDate: body.poReceivedOn,
              firstContactDate: cr.createdAt.toISOString().slice(0, 10),
              countsAsDigital: ctx.settings['digital.verticals'].includes(acc!.vertical),
              forecastCategory: 'COMMIT',
              customerTypeFrozen: acc!.customerType,
              wonAt: new Date(`${body.poReceivedOn}T12:00:00Z`),
              createdBy: auth.user.id,
            })
            .returning();
          await tx.execute(
            sql`INSERT INTO opportunity_qualifications (opportunity_id) VALUES (${opp!.id})`,
          );
          await tx.insert(stageHistory).values({
            opportunityId: opp!.id,
            toStage: 7,
            toStatus: 'OPEN',
            changedBy: auth.user.id,
            reason: `OC ${body.poNumber} del ${cr.code} (P11, tarifa por perfil)`,
          });
          const [po] = await tx
            .insert(contracts)
            .values({
              accountId: cr.accountId,
              opportunityId: opp!.id,
              parentContractId: cr.parentContractId,
              type: 'OC',
              number: body.poNumber,
              title: `OC ${body.poNumber} — ${cr.title}`,
              status: 'SIGNED',
              billingEntityId: parent!.billingEntityId,
              billingEngine: 'B',
              signedOn: body.poReceivedOn,
              ...moneyColumns('amount', cr.amount, cr.amountCurrency, body.poReceivedOn, ctx.fx),
              countsForSs: true,
              repositoryUrl: body.url,
              repositoryUploadedAt: new Date(),
              createdBy: auth.user.id,
            })
            .returning();
          const att = await linkAttachment(tx, {
            url: body.url,
            standardName: body.standardName,
            entityType: 'contract',
            entityId: po!.id,
            accountId: cr.accountId,
            opportunityId: opp!.id,
            contractId: po!.id,
            createdBy: auth.user.id,
          });
          await tx
            .update(contracts)
            .set({ signedAttachmentId: att.id })
            .where(eq(contracts.id, po!.id));
          const [after] = await tx
            .update(changeRequests)
            .set({
              poContractId: po!.id,
              poReceivedOn: body.poReceivedOn,
              opportunityId: opp!.id,
              status: cr.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'PO_RECEIVED',
              updatedAt: new Date(),
            })
            .where(eq(changeRequests.id, id))
            .returning();
          await recordAudit(tx, actorOf(req), {
            action: 'UPDATE',
            category: 'CONTRACT',
            entityType: 'change_request',
            entityId: id,
            accountId: cr.accountId,
            opportunityId: opp!.id,
            changes: [{ field: 'po', old: null, new: body.poNumber }],
          });
          return after;
        }),
      );
    },
  );

  /** P11-02: Country Manager exception (reason + expiry), recorded as EXCEPTION. */
  app.post(
    '/change-requests/:id/exception',
    { config: { guard: { process: 'P11', action: 'approve', actionRole: 'P11.exception' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const body = parse(CrExceptionSchema, req.body);
      if (body.expiresOn < req.today)
        throw ruleViolation([
          { code: 'CR_EXCEPTION_EXPIRED', params: { expiresOn: body.expiresOn } },
        ]);
      return ok(
        await db.transaction(async (tx) => {
          const cr = await lockCr(tx, id);
          const [after] = await tx
            .update(changeRequests)
            .set({
              cmException: true,
              exceptionReason: body.reason,
              exceptionExpiresOn: body.expiresOn,
              exceptionBy: authOf(req).user.id,
              updatedAt: new Date(),
            })
            .where(eq(changeRequests.id, id))
            .returning();
          await recordAudit(tx, actorOf(req), {
            action: 'EXCEPTION',
            category: 'EXCEPTION',
            entityType: 'change_request',
            entityId: id,
            accountId: cr.accountId,
            changes: [
              { field: 'cmException', old: cr.cmException, new: true },
              { field: 'exceptionExpiresOn', old: null, new: body.expiresOn },
            ],
            reason: body.reason,
          });
          return after;
        }),
      );
    },
  );

  app.post(
    '/change-requests/:id/start-work',
    { config: { guard: { process: 'P11', action: 'write' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      return ok(
        await db.transaction(async (tx) => {
          const cr = await lockCr(tx, id);
          if (!['QUOTED', 'PO_RECEIVED'].includes(cr.status))
            throw ruleViolation([{ code: 'STATUS_INVALID', params: { status: cr.status } }]);
          assertRules(canStartWork(cr, req.today));
          const [after] = await tx
            .update(changeRequests)
            .set({ status: 'IN_PROGRESS', workStartedOn: req.today, updatedAt: new Date() })
            .where(eq(changeRequests.id, id))
            .returning();
          await recordAudit(tx, actorOf(req), {
            action: cr.poReceivedOn ? 'UPDATE' : 'EXCEPTION',
            category: cr.poReceivedOn ? 'SCOPE' : 'EXCEPTION',
            entityType: 'change_request',
            entityId: id,
            accountId: cr.accountId,
            changes: [{ field: 'status', old: cr.status, new: 'IN_PROGRESS' }],
            reason: cr.poReceivedOn
              ? null
              : `Trabajo sin OC por excepción CM: ${cr.exceptionReason}`,
          });
          return after;
        }),
      );
    },
  );

  /** P11-04: reception → engine-B milestone accepted with PO + reception evidence (to P8). */
  app.post(
    '/change-requests/:id/reception',
    { config: { guard: { process: 'P11', action: 'write' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const body = parse(CrReceptionSchema, req.body);
      const ctx = await rules.get();
      const auth = authOf(req);
      return ok(
        await db.transaction(async (tx) => {
          const cr = await lockCr(tx, id);
          if (!cr.poContractId || !cr.opportunityId) throw ruleViolation([{ code: 'PO_REQUIRED' }]);
          if (cr.status !== 'IN_PROGRESS' && cr.status !== 'PO_RECEIVED')
            throw ruleViolation([{ code: 'STATUS_INVALID', params: { status: cr.status } }]);
          const [po] = await tx.select().from(contracts).where(eq(contracts.id, cr.poContractId));
          const [ms] = await tx
            .insert(milestones)
            .values({
              contractId: po!.id,
              opportunityId: cr.opportunityId,
              seq: 1,
              name: `${cr.code} — recepción`,
              pct: '100',
              ...moneyColumns('amount', cr.amount, cr.amountCurrency, body.receptionOn, ctx.fx),
              trigger: 'PO_RECEPTION',
              billingEngine: 'B',
              readyAt: new Date(),
              receptionAt: body.receptionOn,
              recognizedOn: body.receptionOn,
              status: 'ACCEPTED',
              createdBy: auth.user.id,
            })
            .returning();
          await tx.insert(milestoneBillingLines).values({
            milestoneId: ms!.id,
            lineNo: 1,
            billingEntityId: po!.billingEntityId,
            description: cr.title,
            ...moneyColumns('amount', cr.amount, cr.amountCurrency, body.receptionOn, ctx.fx),
          });
          const rec = await linkAttachment(tx, {
            url: body.url,
            standardName: body.standardName,
            entityType: 'milestone',
            entityId: ms!.id,
            accountId: cr.accountId,
            opportunityId: cr.opportunityId,
            contractId: po!.id,
            createdBy: auth.user.id,
          });
          await tx.insert(milestoneEvidence).values([
            {
              milestoneId: ms!.id,
              evidenceType: 'PO',
              attachmentId: po!.signedAttachmentId!,
              receivedOn: cr.poReceivedOn,
            },
            {
              milestoneId: ms!.id,
              evidenceType: 'RECEPTION',
              attachmentId: rec.id,
              receivedOn: body.receptionOn,
            },
          ]);
          const [after] = await tx
            .update(changeRequests)
            .set({ status: 'RECEIVED', receptionOn: body.receptionOn, updatedAt: new Date() })
            .where(eq(changeRequests.id, id))
            .returning();
          await recordAudit(tx, actorOf(req), {
            action: 'UPDATE',
            category: 'BILLING',
            entityType: 'change_request',
            entityId: id,
            accountId: cr.accountId,
            opportunityId: cr.opportunityId,
            changes: [{ field: 'status', old: cr.status, new: 'RECEIVED' }],
          });
          return { ...after, milestoneId: ms!.id };
        }),
      );
    },
  );

  app.get(
    '/reports/work-without-po',
    { config: { guard: { process: 'P11', action: 'view' } } },
    async () =>
      ok(
        await db
          .select({ cr: changeRequests, accountName: accounts.name })
          .from(changeRequests)
          .innerJoin(accounts, eq(accounts.id, changeRequests.accountId))
          .where(and(eq(changeRequests.status, 'IN_PROGRESS'), isNull(changeRequests.poReceivedOn)))
          .then((rows) => rows.map((r) => ({ ...r.cr, accountName: r.accountName }))),
      ),
  );
}
