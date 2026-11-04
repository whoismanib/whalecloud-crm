import {
  addBusinessDays,
  aggregateLineItems,
  computeSla,
  compareCashflowVsTc,
  detectConditions,
  ExpectedMilestonesSchema,
  evaluateStageGate,
  lineMargins,
  milestonesFailures,
  parseRepositoryName,
  PriceRequestCreateSchema,
  PriceRequestStatusSchema,
  PriceRequestUpdateSchema,
  routeApproval,
  SheetVersionCreateSchema,
  validatePriceRequest,
  type ApprovalBand,
  type LineItemInput,
} from '@wcrm/shared';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { diffFields, recordAudit } from '../../audit/record';
import type { DbOrTx } from '../../db/client';
import {
  accounts,
  attachments,
  opportunities,
  priceRequestExpectedMilestones,
  priceRequests,
  sheetLineItems,
  sheetMilestones,
  sheetVersions,
} from '../../db/schema/index';
import { assertRules, gateFailed, notFound, ruleViolation } from '../../lib/errors';
import { actorOf, authOf, ok } from '../../lib/http';
import { parse } from '../../lib/validate';
import { moneyColumns } from '../../services/money';
import {
  assertVisible,
  buildGateContext,
  changeStage,
  lockOpportunity,
} from '../../services/opportunities';
import type { RulesContext } from '../../services/rulesContext';
import { invalidateApproval } from '../approvals/service';

const A1_AUDIT_FIELDS = [
  'relationshipType',
  'competitionType',
  'salesOwnerId',
  'solutionOwnerName',
  'deliveryOwnerName',
  'projectStageLabel',
  'projectLevel',
  'budget',
  'signingModel',
  'currency',
  'warrantyMonths',
  'summary',
  'strategy',
  'mainCompetitor',
  'risks',
  'scopeSummary',
  'assumptions',
  'exclusions',
  'billingEngine',
  'targetPrice',
  'targetCompetitor',
];

type PriceRequestRow = typeof priceRequests.$inferSelect;

/** SLA of a request on China's calendar (P5-03, P5-08). */
export function priceRequestSla(pr: PriceRequestRow, ctx: RulesContext, today: string) {
  if (!pr.submittedAt || !pr.slaDays) return null;
  return computeSla({
    start: pr.submittedAt.toISOString().slice(0, 10),
    days: pr.slaDays,
    calendar: ctx.calendars.CN!,
    today,
    pausedBusinessDays: Number(pr.slaPausedBusinessDays),
    doneOn: pr.sheetApprovedAt ? pr.sheetApprovedAt.toISOString().slice(0, 10) : null,
  });
}

async function loadExpected(db: DbOrTx, id: string) {
  return db
    .select()
    .from(priceRequestExpectedMilestones)
    .where(eq(priceRequestExpectedMilestones.priceRequestId, id))
    .orderBy(asc(priceRequestExpectedMilestones.seq));
}

export async function loadSheet(db: DbOrTx, id: string) {
  const [sv] = await db.select().from(sheetVersions).where(eq(sheetVersions.id, id));
  if (!sv) throw notFound();
  const lines = await db
    .select()
    .from(sheetLineItems)
    .where(eq(sheetLineItems.sheetVersionId, id))
    .orderBy(asc(sheetLineItems.lineNo));
  const ms = await db
    .select()
    .from(sheetMilestones)
    .where(eq(sheetMilestones.sheetVersionId, id))
    .orderBy(asc(sheetMilestones.source), asc(sheetMilestones.seq));
  const cashflow = ms.filter((m) => m.source === 'CASHFLOW');
  const tc = ms.filter((m) => m.source === 'TC');
  return {
    ...sv,
    lineItems: lines,
    cashflowMilestones: cashflow,
    tcMilestones: tc,
    milestoneCheck: compareCashflowVsTc(
      cashflow.map((m) => ({ seq: m.seq, pct: m.pct, trigger: m.trigger })),
      tc.map((m) => ({ seq: m.seq, pct: m.pct, trigger: m.trigger })),
    ),
  };
}

export function toLineInputs(lines: (typeof sheetLineItems.$inferSelect)[]): LineItemInput[] {
  return lines.map((l) => ({
    lineNo: l.lineNo,
    itemType: l.itemType,
    cost: l.cost,
    priceExTax: l.priceExTax,
    netIncome: l.netIncome,
    commercialCosts: l.commercialCosts,
    targetMargin: l.targetMargin,
  }));
}

export async function priceRequestRoutes(app: FastifyInstance) {
  const { db, rules } = app.ctx;
  const idParam = z.object({ id: z.string().uuid() });

  async function lockPr(tx: DbOrTx, id: string) {
    const [pr] = await tx
      .select()
      .from(priceRequests)
      .where(eq(priceRequests.id, id))
      .for('update');
    if (!pr) throw notFound();
    return pr;
  }

  app.post(
    '/opportunities/:id/price-requests',
    { config: { guard: { process: 'P5', action: 'write', actionRole: 'P5.a1.write' } } },
    async (req, reply) => {
      const { id } = parse(idParam, req.params);
      const body = parse(PriceRequestCreateSchema, req.body ?? {});
      const ctx = await rules.get();
      const auth = authOf(req);
      const row = await db.transaction(async (tx) => {
        const o = await lockOpportunity(tx, id);
        await assertVisible(tx, auth, o, ctx.raci);
        if (o.status !== 'OPEN') throw ruleViolation([{ code: 'OPPORTUNITY_CLOSED' }]);
        const [acc] = await tx.select().from(accounts).where(eq(accounts.id, o.accountId));
        const [pr] = await tx
          .insert(priceRequests)
          .values({
            opportunityId: id,
            type: body.type,
            countryCode: o.countryCode,
            accountId: o.accountId,
            relationshipType: acc?.customerType === 'NEW' ? 'NEW_CUSTOMER' : 'EXISTING_CUSTOMER',
            salesOwnerId: o.ownerId,
            currency: o.amountCurrency,
            billingEngine: o.billingEngine,
            mainCompetitor: o.competitors[0] ?? null,
            currentHolderRole: 'ACCOUNT_MANAGER',
            createdBy: auth.user.id,
          })
          .returning();
        await tx
          .update(opportunities)
          .set({ currentPriceRequestId: pr!.id })
          .where(eq(opportunities.id, id));
        await recordAudit(tx, actorOf(req), {
          action: 'CREATE',
          category: 'PRICE',
          entityType: 'price_request',
          entityId: pr!.id,
          opportunityId: id,
          accountId: o.accountId,
        });
        return pr!;
      });
      return reply.status(201).send(ok(row));
    },
  );

  app.get(
    '/price-requests',
    { config: { guard: { process: 'P5', action: 'view' } } },
    async (req) => {
      const ctx = await rules.get();
      const rows = await db
        .select({
          pr: priceRequests,
          opportunityName: opportunities.name,
          opportunityCode: opportunities.code,
          accountName: accounts.name,
        })
        .from(priceRequests)
        .innerJoin(opportunities, eq(opportunities.id, priceRequests.opportunityId))
        .innerJoin(accounts, eq(accounts.id, opportunities.accountId))
        .orderBy(desc(priceRequests.createdAt));
      return ok(
        rows.map((r) => ({
          ...r.pr,
          opportunityName: r.opportunityName,
          opportunityCode: r.opportunityCode,
          accountName: r.accountName,
          sla: priceRequestSla(r.pr, ctx, req.today),
        })),
      );
    },
  );

  app.get(
    '/price-requests/:id',
    { config: { guard: { process: 'P5', action: 'view' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const [pr] = await db.select().from(priceRequests).where(eq(priceRequests.id, id));
      if (!pr) throw notFound();
      const ctx = await rules.get();
      const expected = await loadExpected(db, id);
      const versions = await db
        .select()
        .from(sheetVersions)
        .where(eq(sheetVersions.priceRequestId, id))
        .orderBy(desc(sheetVersions.versionSeq));
      const current = versions.find((v) => v.isCurrent);
      return ok({
        ...pr,
        expectedMilestones: expected,
        sheetVersions: versions,
        currentSheet: current ? await loadSheet(db, current.id) : null,
        sla: priceRequestSla(pr, ctx, req.today),
        validation: validatePriceRequest({ ...pr, expectedMilestones: expected }),
      });
    },
  );

  app.patch(
    '/price-requests/:id',
    { config: { guard: { process: 'P5', action: 'write', actionRole: 'P5.a1.write' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const body = parse(PriceRequestUpdateSchema, req.body);
      const ctx = await rules.get();
      return ok(
        await db.transaction(async (tx) => {
          const before = await lockPr(tx, id);
          if (before.status !== 'DRAFT') throw ruleViolation([{ code: 'PRICE_REQUEST_NOT_DRAFT' }]);
          const { budget, budgetCurrency, targetPrice, targetPriceCurrency, ...rest } = body;
          const patch: Record<string, unknown> = { ...rest };
          if (budget !== undefined || budgetCurrency !== undefined) {
            Object.assign(
              patch,
              moneyColumns(
                'budget',
                budget ?? before.budget,
                budgetCurrency ?? before.budgetCurrency ?? before.currency,
                req.today,
                ctx.fx,
              ),
            );
          }
          if (targetPrice !== undefined || targetPriceCurrency !== undefined) {
            Object.assign(
              patch,
              moneyColumns(
                'targetPrice',
                targetPrice ?? before.targetPrice,
                targetPriceCurrency ?? before.targetPriceCurrency ?? before.currency,
                req.today,
                ctx.fx,
              ),
            );
          }
          const [after] = await tx
            .update(priceRequests)
            .set({ ...patch, updatedAt: new Date(), rowVersion: before.rowVersion + 1 })
            .where(eq(priceRequests.id, id))
            .returning();
          await recordAudit(tx, actorOf(req), {
            action: 'UPDATE',
            category: 'PRICE',
            entityType: 'price_request',
            entityId: id,
            opportunityId: before.opportunityId,
            changes: diffFields(before, after!, A1_AUDIT_FIELDS),
          });
          return after;
        }),
      );
    },
  );

  app.put(
    '/price-requests/:id/expected-milestones',
    { config: { guard: { process: 'P5', action: 'write', actionRole: 'P5.a1.write' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const body = parse(ExpectedMilestonesSchema, req.body);
      assertRules(milestonesFailures(body));
      return ok(
        await db.transaction(async (tx) => {
          const pr = await lockPr(tx, id);
          if (pr.status !== 'DRAFT') throw ruleViolation([{ code: 'PRICE_REQUEST_NOT_DRAFT' }]);
          await tx
            .delete(priceRequestExpectedMilestones)
            .where(eq(priceRequestExpectedMilestones.priceRequestId, id));
          await tx.insert(priceRequestExpectedMilestones).values(
            body.map((m) => ({
              priceRequestId: id,
              seq: m.seq,
              pct: m.pct,
              trigger: m.trigger,
              triggerText: m.triggerText ?? null,
            })),
          );
          await recordAudit(tx, actorOf(req), {
            action: 'UPDATE',
            category: 'SCOPE',
            entityType: 'price_request',
            entityId: id,
            opportunityId: pr.opportunityId,
            changes: [
              {
                field: 'expectedMilestones',
                old: null,
                new: body.map((m) => `${m.pct}% ${m.trigger}`),
              },
            ],
          });
          return loadExpected(tx, id);
        }),
      );
    },
  );

  /** P5-03: A1 complete + 4 data + stage gate up to 4 → SUBMITTED, opportunity to stage 4, SLA starts. */
  app.post(
    '/price-requests/:id/submit',
    { config: { guard: { process: 'P5', action: 'write', actionRole: 'P5.submit' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const ctx = await rules.get();
      return ok(
        await db.transaction(async (tx) => {
          const pr = await lockPr(tx, id);
          if (pr.status !== 'DRAFT') throw ruleViolation([{ code: 'PRICE_REQUEST_NOT_DRAFT' }]);
          const expected = await loadExpected(tx, id);
          assertRules(validatePriceRequest({ ...pr, expectedMilestones: expected }));
          const opp = await lockOpportunity(tx, pr.opportunityId);
          await assertVisible(tx, authOf(req), opp, ctx.raci);
          if (opp.stage < 4) {
            const gctx = {
              ...(await buildGateContext(tx, opp, ctx.settings)),
              priceRequestSubmitted: true,
            };
            const g = evaluateStageGate(gctx, opp.stage, 4, ctx.settings, req.today, {
              status: opp.status,
            });
            if (!g.ok) throw gateFailed(g.failures, opp.stage, 4);
          }
          const slaDays =
            pr.type === 'CR'
              ? ctx.settings['sla.businessDays'].P5_CR
              : ctx.settings['sla.businessDays'].P5_PROJECT;
          const [after] = await tx
            .update(priceRequests)
            .set({
              status: 'SUBMITTED',
              submittedAt: new Date(),
              slaDays,
              slaDueOn: addBusinessDays(req.today, slaDays, ctx.calendars.CN!),
              currentHolderRole: 'CHINA_SALES',
              updatedAt: new Date(),
            })
            .where(eq(priceRequests.id, id))
            .returning();
          await recordAudit(tx, actorOf(req), {
            action: 'UPDATE',
            category: 'PRICE',
            entityType: 'price_request',
            entityId: id,
            opportunityId: opp.id,
            accountId: opp.accountId,
            changes: [{ field: 'status', old: 'DRAFT', new: 'SUBMITTED' }],
          });
          await tx
            .update(opportunities)
            .set({ currentPriceRequestId: id })
            .where(eq(opportunities.id, opp.id));
          if (opp.stage < 4) {
            await changeStage(tx, { ...opp, currentPriceRequestId: id }, 4, actorOf(req), {
              reason: 'Solicitud de precio enviada (P5-03)',
            });
          }
          return after;
        }),
      );
    },
  );

  app.post(
    '/price-requests/:id/status',
    { config: { guard: { process: 'P5', action: 'write', actionRole: 'P5.status' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const body = parse(PriceRequestStatusSchema, req.body);
      return ok(
        await db.transaction(async (tx) => {
          const pr = await lockPr(tx, id);
          if (['DRAFT', 'APPROVED', 'CANCELLED'].includes(pr.status)) {
            throw ruleViolation([{ code: 'STATUS_INVALID', params: { status: pr.status } }]);
          }
          const [after] = await tx
            .update(priceRequests)
            .set({
              status: body.status,
              currentHolderRole: body.holderRole ?? pr.currentHolderRole,
              updatedAt: new Date(),
            })
            .where(eq(priceRequests.id, id))
            .returning();
          await recordAudit(tx, actorOf(req), {
            action: 'UPDATE',
            category: 'PRICE',
            entityType: 'price_request',
            entityId: id,
            opportunityId: pr.opportunityId,
            changes: [{ field: 'status', old: pr.status, new: body.status }],
          });
          return after;
        }),
      );
    },
  );

  /** P5-05/06: China loads each sheet version with outputs per line item and milestones. */
  app.post(
    '/price-requests/:id/sheet-versions',
    { config: { guard: { process: 'P5', action: 'write', actionRole: 'P5.sheetVersion.write' } } },
    async (req, reply) => {
      const { id } = parse(idParam, req.params);
      const body = parse(SheetVersionCreateSchema, req.body);
      const ctx = await rules.get();
      const targets = ctx.settings['margins.targets'];
      if (body.fileStandardName && !parseRepositoryName(body.fileStandardName)) {
        throw ruleViolation([{ code: 'NAMING_INVALID', params: { name: body.fileStandardName } }]);
      }
      const lines = body.lineItems.map((l) => {
        const m = lineMargins({ ...l, targetMargin: l.targetMargin ?? null }, targets);
        return { ...l, ...m };
      });
      const agg = aggregateLineItems(body.lineItems);
      const route = routeApproval(
        body.lineItems.map((l) => ({ ...l, targetMargin: l.targetMargin ?? null })),
        detectConditions(body.tcTerms, ctx.settings),
        ctx.settings,
      );
      const row = await db.transaction(async (tx) => {
        const pr = await lockPr(tx, id);
        if (pr.status === 'DRAFT' || pr.status === 'CANCELLED') {
          throw ruleViolation([{ code: 'PRICE_REQUEST_NOT_SUBMITTED' }]);
        }
        const opp = await lockOpportunity(tx, pr.opportunityId);
        const [{ seq } = { seq: 0 }] = await tx
          .select({ seq: sql<number>`coalesce(max(${sheetVersions.versionSeq}),0)::int` })
          .from(sheetVersions)
          .where(eq(sheetVersions.priceRequestId, id));
        await tx
          .update(sheetVersions)
          .set({ isCurrent: false })
          .where(eq(sheetVersions.priceRequestId, id));
        let fileAttachmentId: string | null = null;
        if (body.fileStandardName && body.fileUrl) {
          const p = parseRepositoryName(body.fileStandardName)!;
          const [att] = await tx
            .insert(attachments)
            .values({
              externalUrl: body.fileUrl,
              standardName: body.fileStandardName,
              nameCountry: p.country,
              nameClient: p.client,
              docKind: p.type,
              docNumber: p.number,
              versionLabel: p.version,
              docDate: p.date,
              entityType: 'price_request',
              entityId: id,
              accountId: opp.accountId,
              opportunityId: opp.id,
            })
            .returning();
          fileAttachmentId = att!.id;
        }
        const [sv] = await tx
          .insert(sheetVersions)
          .values({
            priceRequestId: id,
            opportunityId: opp.id,
            versionLabel: body.versionLabel,
            versionSeq: seq + 1,
            isCurrent: true,
            fileAttachmentId,
            currency: body.currency,
            totalPriceExTax: agg.totalPriceExTax,
            totalCost: agg.totalCost,
            totalNetIncome: agg.totalNetIncome,
            totalCommercialCosts: agg.totalCommercialCosts,
            netMargin: agg.netMargin,
            contractMargin: agg.contractMargin,
            minLineNetMargin: route.minLineMargin,
            proposedBand: route.band as ApprovalBand,
            offerValidityDays: body.tcTerms.offerValidityDays,
            paymentTermDays: body.tcTerms.paymentTermDays ?? null,
            clpWithoutFxPremium: body.tcTerms.clpWithoutFxPremium,
            penaltyCapPct: body.tcTerms.penaltyCapPct ?? null,
            unlimitedLiability: body.tcTerms.unlimitedLiability,
            tcEntities: body.tcTerms.entities ?? null,
            notes: body.notes ?? null,
            createdBy: authOf(req).user.id,
          })
          .returning();
        await tx.insert(sheetLineItems).values(
          lines.map((l) => ({
            sheetVersionId: sv!.id,
            lineNo: l.lineNo,
            block: l.block ?? null,
            itemType: l.itemType,
            capexOpex: l.capexOpex,
            description: l.description ?? null,
            quantity: l.quantity ?? '1',
            cost: l.cost,
            targetMargin: l.targetMargin,
            priceExTax: l.priceExTax,
            netIncome: l.netIncome,
            commercialCosts: l.commercialCosts,
            netMargin: l.netMargin,
            contractMargin: l.contractMargin,
            band: route.lines.find((r) => r.lineNo === l.lineNo)?.band ?? null,
            supportYears: l.supportYears ?? null,
          })),
        );
        const ms = [
          ...body.cashflowMilestones.map((m) => ({ ...m, source: 'CASHFLOW' as const })),
          ...body.tcMilestones.map((m) => ({ ...m, source: 'TC' as const })),
        ];
        if (ms.length) {
          await tx.insert(sheetMilestones).values(
            ms.map((m) => ({
              sheetVersionId: sv!.id,
              source: m.source,
              seq: m.seq,
              pct: m.pct,
              trigger: m.trigger,
              triggerText: m.triggerText ?? null,
              expectedQuarter: m.expectedQuarter ?? null,
            })),
          );
        }
        await tx
          .update(priceRequests)
          .set({
            versionsCount: pr.versionsCount + 1,
            status: pr.status === 'APPROVED' || pr.status === 'REJECTED' ? 'BUILDING' : pr.status,
            updatedAt: new Date(),
          })
          .where(eq(priceRequests.id, id));
        await tx
          .update(opportunities)
          .set({ currentSheetVersionId: sv!.id, chinaSheetVersionLabel: body.versionLabel })
          .where(eq(opportunities.id, opp.id));
        await recordAudit(tx, actorOf(req), {
          action: 'CREATE',
          category: 'PRICE',
          entityType: 'sheet_version',
          entityId: sv!.id,
          opportunityId: opp.id,
          accountId: opp.accountId,
          changes: [
            { field: 'versionLabel', old: null, new: body.versionLabel },
            { field: 'totalPriceExTax', old: null, new: agg.totalPriceExTax },
            { field: 'netMargin', old: null, new: agg.netMargin },
            { field: 'contractMargin', old: null, new: agg.contractMargin },
          ],
        });
        // P6-05: a new sheet version (price/scope change) invalidates the current approval
        if (opp.currentApprovalRequestId) {
          await invalidateApproval(
            tx,
            opp.currentApprovalRequestId,
            actorOf(req),
            'NEW_SHEET_VERSION',
          );
        }
        return sv!;
      });
      return reply.status(201).send(ok(await loadSheet(db, row.id)));
    },
  );

  app.get(
    '/sheet-versions/:id',
    { config: { guard: { process: 'P5', action: 'view' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      return ok(await loadSheet(db, id));
    },
  );

  app.get(
    '/sheet-versions/:id/milestone-check',
    { config: { guard: { process: 'P5', action: 'view' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      return ok((await loadSheet(db, id)).milestoneCheck);
    },
  );

  app.get(
    '/opportunities/:id/price-requests',
    { config: { guard: { process: 'P5', action: 'view' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const ctx = await rules.get();
      const rows = await db
        .select()
        .from(priceRequests)
        .where(and(eq(priceRequests.opportunityId, id)))
        .orderBy(desc(priceRequests.createdAt));
      return ok(rows.map((r) => ({ ...r, sla: priceRequestSla(r, ctx, req.today) })));
    },
  );
}
