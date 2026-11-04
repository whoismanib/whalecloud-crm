import {
  ContractCreateSchema,
  ContractSignSchema,
  ContractUpdateSchema,
  D,
  MilestoneCreateSchema,
  money,
  parseRepositoryName,
  type BillingEngine,
} from '@wcrm/shared';
import { and, asc, desc, eq, inArray, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { diffFields, recordAudit } from '../../audit/record';
import type { DbOrTx } from '../../db/client';
import {
  accounts,
  approvalRequests,
  attachments,
  billingEntities,
  contracts,
  milestoneBillingLines,
  milestones,
  opportunities,
  sheetMilestones,
} from '../../db/schema/index';
import { notFound, ruleViolation } from '../../lib/errors';
import { actorOf, authOf, ok } from '../../lib/http';
import { parse } from '../../lib/validate';
import { moneyColumns } from '../../services/money';
import { assertVisible, recomputeDerivedStage } from '../../services/opportunities';

const CONTRACT_FIELDS = [
  'type',
  'number',
  'title',
  'status',
  'amount',
  'amountCurrency',
  'signedOn',
  'repositoryUrl',
  'chinaSystemId',
  'endDate',
];

/** Creates an external-link attachment with a validated standard name (CORE-07). */
export async function linkAttachment(
  tx: DbOrTx,
  p: {
    url: string;
    standardName: string;
    entityType: string;
    entityId: string;
    accountId?: string | null;
    opportunityId?: string | null;
    contractId?: string | null;
    createdBy: string;
  },
) {
  const parsed = parseRepositoryName(p.standardName);
  if (!parsed) throw ruleViolation([{ code: 'NAMING_INVALID', params: { name: p.standardName } }]);
  const [att] = await tx
    .insert(attachments)
    .values({
      externalUrl: p.url,
      standardName: p.standardName,
      nameCountry: parsed.country,
      nameClient: parsed.client,
      docKind: parsed.type,
      docNumber: parsed.number,
      versionLabel: parsed.version,
      docDate: parsed.date,
      entityType: p.entityType,
      entityId: p.entityId,
      accountId: p.accountId ?? null,
      opportunityId: p.opportunityId ?? null,
      contractId: p.contractId ?? null,
      createdBy: p.createdBy,
    })
    .returning();
  return att!;
}

export async function contractRoutes(app: FastifyInstance) {
  const { db, rules } = app.ctx;
  const idParam = z.object({ id: z.string().uuid() });

  app.get('/contracts', { config: { guard: { process: 'P7', action: 'view' } } }, async (req) => {
    const q = parse(
      z.object({
        opportunityId: z.string().uuid().optional(),
        accountId: z.string().uuid().optional(),
      }),
      req.query,
    );
    const where: SQL[] = [];
    if (q.opportunityId) where.push(eq(contracts.opportunityId, q.opportunityId));
    if (q.accountId) where.push(eq(contracts.accountId, q.accountId));
    const rows = await db
      .select({ c: contracts, accountName: accounts.name, standardName: attachments.standardName })
      .from(contracts)
      .innerJoin(accounts, eq(accounts.id, contracts.accountId))
      .leftJoin(attachments, eq(attachments.id, contracts.signedAttachmentId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(contracts.createdAt));
    return ok(
      rows.map((r) => ({ ...r.c, accountName: r.accountName, signedStandardName: r.standardName })),
    );
  });

  app.post(
    '/contracts',
    { config: { guard: { process: 'P7', action: 'write' } } },
    async (req, reply) => {
      const body = parse(ContractCreateSchema, req.body);
      const ctx = await rules.get();
      const auth = authOf(req);
      if (body.opportunityId) {
        const [o] = await db
          .select()
          .from(opportunities)
          .where(eq(opportunities.id, body.opportunityId));
        if (!o || o.accountId !== body.accountId)
          throw ruleViolation([{ code: 'OPPORTUNITY_NOT_IN_ACCOUNT' }]);
        await assertVisible(db, auth, o, ctx.raci);
      }
      const [acc] = await db.select().from(accounts).where(eq(accounts.id, body.accountId));
      if (!acc) throw notFound();
      // P8-08: account with new work suspended blocks new OC/CR
      if (acc.newWorkSuspended && (body.type === 'OC' || body.type === 'CR')) {
        throw ruleViolation([{ code: 'ACCOUNT_SUSPENDED' }]);
      }
      const row = await db.transaction(async (tx) => {
        const { amount, currency, ...rest } = body;
        const [c] = await tx
          .insert(contracts)
          .values({
            ...rest,
            ...moneyColumns(
              'amount',
              amount ?? null,
              currency ?? null,
              body.startDate ?? req.today,
              ctx.fx,
            ),
            countsForSs: ['SOW', 'OC', 'CR'].includes(body.type),
            createdBy: auth.user.id,
          })
          .returning();
        await recordAudit(tx, actorOf(req), {
          action: 'CREATE',
          category: 'CONTRACT',
          entityType: 'contract',
          entityId: c!.id,
          opportunityId: c!.opportunityId,
          accountId: c!.accountId,
          changes: diffFields(null, c!, CONTRACT_FIELDS),
        });
        return c!;
      });
      return reply.status(201).send(ok(row));
    },
  );

  /** P7-05: signed document in the repository with the standard name + China system ID. */
  app.post(
    '/contracts/:id/sign',
    { config: { guard: { process: 'P7', action: 'write' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const body = parse(ContractSignSchema, req.body);
      const ctx = await rules.get();
      const auth = authOf(req);
      return ok(
        await db.transaction(async (tx) => {
          const [before] = await tx
            .select()
            .from(contracts)
            .where(eq(contracts.id, id))
            .for('update');
          if (!before) throw notFound();
          if (!['DRAFT', 'IN_LEGAL_REVIEW'].includes(before.status)) {
            throw ruleViolation([{ code: 'STATUS_INVALID', params: { status: before.status } }]);
          }
          const att = await linkAttachment(tx, {
            url: body.repositoryUrl,
            standardName: body.standardName,
            entityType: 'contract',
            entityId: id,
            accountId: before.accountId,
            opportunityId: before.opportunityId,
            contractId: id,
            createdBy: auth.user.id,
          });
          const [after] = await tx
            .update(contracts)
            .set({
              status: 'SIGNED',
              signedOn: body.signedOn,
              repositoryUrl: body.repositoryUrl,
              signedAttachmentId: att.id,
              repositoryUploadedAt: new Date(),
              chinaSystemId: body.chinaSystemId,
              // FX of the signing month (ARCHITECTURE §9)
              ...moneyColumns(
                'amount',
                before.amount,
                before.amountCurrency,
                body.signedOn,
                ctx.fx,
              ),
              updatedAt: new Date(),
              rowVersion: before.rowVersion + 1,
            })
            .where(eq(contracts.id, id))
            .returning();
          if (before.opportunityId) {
            await tx
              .update(opportunities)
              .set({ chinaSystemContractId: body.chinaSystemId })
              .where(eq(opportunities.id, before.opportunityId));
          }
          await recordAudit(tx, actorOf(req), {
            action: 'UPDATE',
            category: 'CONTRACT',
            entityType: 'contract',
            entityId: id,
            opportunityId: before.opportunityId,
            accountId: before.accountId,
            changes: diffFields(before, after!, CONTRACT_FIELDS),
          });
          return after;
        }),
      );
    },
  );

  app.patch(
    '/contracts/:id',
    { config: { guard: { process: 'P7', action: 'write' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const body = parse(ContractUpdateSchema, req.body);
      return ok(
        await db.transaction(async (tx) => {
          const [before] = await tx
            .select()
            .from(contracts)
            .where(eq(contracts.id, id))
            .for('update');
          if (!before) throw notFound();
          const repo = body.repositoryUrl !== undefined ? body.repositoryUrl : before.repositoryUrl;
          // CORE-03: no "vigente" without repository link
          if (body.status && ['SIGNED', 'ACTIVE'].includes(body.status) && !repo) {
            throw ruleViolation([{ code: 'REPOSITORY_LINK_REQUIRED' }]);
          }
          const [after] = await tx
            .update(contracts)
            .set({ ...body, updatedAt: new Date(), rowVersion: before.rowVersion + 1 })
            .where(eq(contracts.id, id))
            .returning();
          await recordAudit(tx, actorOf(req), {
            action: 'UPDATE',
            category: 'CONTRACT',
            entityType: 'contract',
            entityId: id,
            opportunityId: before.opportunityId,
            accountId: before.accountId,
            changes: diffFields(before, after!, CONTRACT_FIELDS),
          });
          return after;
        }),
      );
    },
  );

  /** P7-06: milestones of the contract from the approved T&C (amount = % × contract amount). */
  app.post(
    '/contracts/:id/milestones/from-tc',
    { config: { guard: { process: 'P7', action: 'write' } } },
    async (req, reply) => {
      const { id } = parse(idParam, req.params);
      const ctx = await rules.get();
      const auth = authOf(req);
      const rows = await db.transaction(async (tx) => {
        const [c] = await tx.select().from(contracts).where(eq(contracts.id, id)).for('update');
        if (!c) throw notFound();
        if (!c.opportunityId || !c.amount || !c.amountCurrency) {
          throw ruleViolation([{ code: 'CONTRACT_AMOUNT_REQUIRED' }]);
        }
        const [o] = await tx
          .select()
          .from(opportunities)
          .where(eq(opportunities.id, c.opportunityId));
        const [ar] = o?.currentApprovalRequestId
          ? await tx
              .select()
              .from(approvalRequests)
              .where(eq(approvalRequests.id, o.currentApprovalRequestId))
          : [];
        if (!o || !ar || ar.status !== 'APPROVED')
          throw ruleViolation([{ code: 'APPROVAL_MISSING' }]);
        const tc = await tx
          .select()
          .from(sheetMilestones)
          .where(
            and(
              eq(sheetMilestones.sheetVersionId, ar.sheetVersionId),
              eq(sheetMilestones.source, 'TC'),
            ),
          )
          .orderBy(asc(sheetMilestones.seq));
        if (!tc.length) throw ruleViolation([{ code: 'MILESTONES_MISSING' }]);
        const existing = await tx
          .select({ id: milestones.id })
          .from(milestones)
          .where(eq(milestones.contractId, id));
        if (existing.length) throw ruleViolation([{ code: 'MILESTONES_ALREADY_CREATED' }]);
        const [entity] = await tx
          .select()
          .from(billingEntities)
          .where(eq(billingEntities.id, c.billingEntityId));
        const engine = (c.billingEngine ?? o.billingEngine) as BillingEngine;
        const out = [];
        for (const m of tc) {
          const amount = money(D(c.amount).times(D(m.pct)).div(100));
          const date = c.signedOn ?? req.today;
          const [ms] = await tx
            .insert(milestones)
            .values({
              contractId: id,
              opportunityId: o.id,
              seq: m.seq,
              name: m.triggerText ?? `${m.pct}% ${m.trigger}`,
              pct: m.pct,
              ...moneyColumns('amount', amount, c.amountCurrency, date, ctx.fx),
              trigger: m.trigger,
              billingEngine: engine,
              createdBy: auth.user.id,
            })
            .returning();
          await tx.insert(milestoneBillingLines).values({
            milestoneId: ms!.id,
            lineNo: 1,
            billingEntityId: c.billingEntityId,
            description: c.title,
            ...moneyColumns('amount', amount, c.amountCurrency, date, ctx.fx),
            vatPct: entity?.vatPct ?? null,
            withholdingPct: entity?.withholdingPct ?? null,
          });
          out.push(ms!);
        }
        await recordAudit(tx, actorOf(req), {
          action: 'CREATE',
          category: 'BILLING',
          entityType: 'contract_milestones',
          entityId: id,
          opportunityId: o.id,
          accountId: c.accountId,
          changes: [
            { field: 'milestones', old: null, new: tc.map((m) => `${m.pct}% ${m.trigger}`) },
          ],
        });
        return out;
      });
      return reply.status(201).send(ok(rows));
    },
  );

  /** CORE-05: manual milestone with one billing line on the contract entity. */
  app.post(
    '/contracts/:id/milestones',
    { config: { guard: { process: 'P8', action: 'write' } } },
    async (req, reply) => {
      const { id } = parse(idParam, req.params);
      const body = parse(MilestoneCreateSchema, req.body);
      const ctx = await rules.get();
      const row = await db.transaction(async (tx) => {
        const [c] = await tx.select().from(contracts).where(eq(contracts.id, id));
        if (!c) throw notFound();
        if (!c.opportunityId) throw ruleViolation([{ code: 'CONTRACT_WITHOUT_OPPORTUNITY' }]);
        const [o] = await tx
          .select()
          .from(opportunities)
          .where(eq(opportunities.id, c.opportunityId));
        const [entity] = await tx
          .select()
          .from(billingEntities)
          .where(eq(billingEntities.id, c.billingEntityId));
        const date = body.plannedDate ?? c.signedOn ?? req.today;
        const [ms] = await tx
          .insert(milestones)
          .values({
            contractId: id,
            opportunityId: c.opportunityId,
            seq: body.seq,
            name: body.name,
            pct: body.pct ?? null,
            ...moneyColumns('amount', body.amount, body.currency, date, ctx.fx),
            trigger: body.trigger ?? null,
            billingEngine: (c.billingEngine ?? o!.billingEngine) as BillingEngine,
            plannedDate: body.plannedDate ?? null,
            acceptanceCriteria: body.acceptanceCriteria ?? null,
            createdBy: authOf(req).user.id,
          })
          .returning();
        await tx.insert(milestoneBillingLines).values({
          milestoneId: ms!.id,
          lineNo: 1,
          billingEntityId: c.billingEntityId,
          description: body.name,
          ...moneyColumns('amount', body.amount, body.currency, date, ctx.fx),
          vatPct: entity?.vatPct ?? null,
          withholdingPct: entity?.withholdingPct ?? null,
        });
        await recordAudit(tx, actorOf(req), {
          action: 'CREATE',
          category: 'BILLING',
          entityType: 'milestone',
          entityId: ms!.id,
          opportunityId: c.opportunityId,
          accountId: c.accountId,
        });
        await recomputeDerivedStage(tx, c.opportunityId, actorOf(req));
        return ms!;
      });
      return reply.status(201).send(ok(row));
    },
  );

  app.get(
    '/contracts/:id',
    { config: { guard: { process: 'P7', action: 'view' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const [c] = await db.select().from(contracts).where(eq(contracts.id, id));
      if (!c) throw notFound();
      const atts = await db.select().from(attachments).where(eq(attachments.contractId, id));
      const ms = await db
        .select()
        .from(milestones)
        .where(eq(milestones.contractId, id))
        .orderBy(asc(milestones.seq));
      const lines = ms.length
        ? await db
            .select()
            .from(milestoneBillingLines)
            .where(
              inArray(
                milestoneBillingLines.milestoneId,
                ms.map((m) => m.id),
              ),
            )
        : [];
      return ok({
        ...c,
        attachments: atts,
        milestones: ms.map((m) => ({
          ...m,
          billingLines: lines.filter((l) => l.milestoneId === m.id),
        })),
      });
    },
  );
}
