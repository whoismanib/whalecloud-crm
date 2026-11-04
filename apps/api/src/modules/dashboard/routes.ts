import {
  convert,
  D,
  Decimal,
  healthScore,
  legacyGoalBucket,
  money,
  paymentsTotal,
  pendingAcceptances,
  pipelineCoverage,
  priceTime,
  profit,
  rag,
  receivablesAging,
  recognizedRevenue,
  ssSigned,
  stageToLegacyStatus,
  weightedPipeline,
  yearPace,
  addDays,
  type Currency,
  type HealthStatus,
} from '@wcrm/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/client';
import { computeProcessKpis } from './processKpis';
import {
  accounts,
  approvalRequests,
  contracts,
  invoices,
  milestones,
  opportunities,
  payments,
  priceRequests,
  sheetVersions,
  targets,
  tickets,
  users,
} from '../../db/schema/index';
import { authOf, ok } from '../../lib/http';
import { parse } from '../../lib/validate';
import type { RulesContext } from '../../services/rulesContext';
import { visibilityFilter } from '../../services/opportunities';
import type { AuthInfo } from '../../types';

const Query = z.object({
  year: z.coerce.number().int().min(2020).max(2100).optional(),
  currency: z.enum(['CNY', 'USD', 'CLP']).default('CNY'),
});

const MM = 1_000_000;
const mm = (v: string | Decimal) => D(v).div(MM).toDecimalPlaces(2).toNumber();
type Col = 'Cny' | 'Usd' | 'Clp';
const col = (c: Currency): Col => (c === 'USD' ? 'Usd' : c === 'CLP' ? 'Clp' : 'Cny');

/** Converts an amount stored in its original currency to the display currency (KPIS.md §1). */
function toDisplay(
  ctx: RulesContext,
  amount: string | null,
  from: Currency | null,
  date: string,
  to: Currency,
): string {
  if (!amount || !from) return '0.00';
  try {
    return convert(amount, from, to, date, ctx.fx).amount;
  } catch {
    return '0.00';
  }
}

async function overdueSlaByOpp(db: Db, today: string): Promise<Map<string, number>> {
  const r = await db.execute<{ opportunity_id: string; n: number }>(sql`
    SELECT opportunity_id, count(*)::int AS n FROM (
      SELECT ar.opportunity_id FROM approval_steps s JOIN approval_requests ar ON ar.id = s.approval_request_id
        WHERE s.status = 'PENDING' AND s.due_on < ${today}
      UNION ALL
      SELECT opportunity_id FROM price_requests
        WHERE status IN ('SUBMITTED','COSTING','BUILDING','READY_FOR_APPROVAL') AND sla_due_on < ${today}
      UNION ALL
      SELECT opportunity_id FROM milestones WHERE status = 'READY' AND ac_due_on < ${today}
      UNION ALL
      SELECT m.opportunity_id FROM invoices i JOIN milestones m ON m.id = i.milestone_id
        WHERE i.balance > 0 AND i.due_on < ${today}
    ) x GROUP BY opportunity_id`);
  return new Map(r.rows.map((x) => [x.opportunity_id, x.n]));
}

export async function computeHealth(db: Db, ctx: RulesContext, auth: AuthInfo, today: string) {
  const rows = await db
    .select({ o: opportunities, accountName: accounts.name, ownerName: users.fullName })
    .from(opportunities)
    .innerJoin(accounts, eq(accounts.id, opportunities.accountId))
    .innerJoin(users, eq(users.id, opportunities.ownerId))
    .where(and(eq(opportunities.status, 'OPEN'), visibilityFilter(auth, ctx.raci)));
  const sla = await overdueSlaByOpp(db, today);
  return rows.map((r) => {
    const h = healthScore(
      {
        status: r.o.status,
        stage: r.o.stage,
        onHold: r.o.onHold,
        lastActivityOn: r.o.lastActivityAt ? r.o.lastActivityAt.toISOString().slice(0, 10) : null,
        lastUpdatedOn: r.o.updatedAt.toISOString().slice(0, 10),
        expectedCloseDate: r.o.expectedCloseDate,
        overdueSlaCount: sla.get(r.o.id) ?? 0,
        risk: r.o.risk,
        today,
      },
      ctx.calendars.CL!,
      ctx.settings,
    );
    return {
      id: r.o.id,
      code: r.o.code,
      name: r.o.name,
      accountId: r.o.accountId,
      accountName: r.accountName,
      ownerName: r.ownerName,
      stage: r.o.stage,
      vertical: r.o.vertical,
      amountUsd: r.o.amountUsd,
      risk: r.o.risk,
      expectedCloseDate: r.o.expectedCloseDate,
      legacyStatus: stageToLegacyStatus(r.o.stage, r.o.status),
      section: r.o.stage >= 7 ? 'DELIVERY' : 'PIPELINE',
      overdueSlaCount: sla.get(r.o.id) ?? 0,
      ...h,
    };
  });
}

export async function dashboardRoutes(app: FastifyInstance) {
  const { db, rules } = app.ctx;

  app.get(
    '/dashboard/health',
    { config: { guard: { process: 'DASH', action: 'view' } } },
    async (req) => {
      const ctx = await rules.get();
      return ok(await computeHealth(db, ctx, authOf(req), req.today));
    },
  );

  /** DASH-05: KPIs per process P1–P16 (KPIS.md §4). */
  app.get(
    '/dashboard/process-kpis',
    { config: { guard: { process: 'DASH', action: 'view' } } },
    async (req) => ok(await computeProcessKpis(db, await rules.get(), authOf(req), req.today)),
  );

  app.get(
    '/dashboard/kpis',
    { config: { guard: { process: 'DASH', action: 'view' } } },
    async (req) =>
      ok(await computeDashboard(db, await rules.get(), authOf(req), req.today, req.query)),
  );
}

/** 10 KPIs (KPIS.md §3) + legacy "Resumen" cards + chart series (DASH-01/02/03). */
export async function computeDashboard(
  db: Db,
  ctx: RulesContext,
  auth: AuthInfo,
  todayIso: string,
  query: unknown,
) {
  const q = parse(Query, query);
  const today = todayIso;
  const year = q.year ?? Number(today.slice(0, 4));
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const asOf = today < to ? today : to;
  const cur = q.currency;
  const c = col(cur);
  const pace = today.slice(0, 4) === String(year) ? yearPace(today) : 1;
  const amber = ctx.settings['kpi.rag'].amberPctOfPace;

  const [
    contractRows,
    paymentRows,
    msRows,
    invRows,
    prRows,
    oppRows,
    wonRows,
    tgtRows,
    ticketRows,
  ] = await Promise.all([
    db
      .select({
        type: contracts.type,
        countsForSs: contracts.countsForSs,
        signedOn: contracts.signedOn,
        amount: sql<string>`coalesce(${contracts}.${sql.raw(`amount_${c.toLowerCase()}`)}, 0)::text`,
        stage: opportunities.stage,
        oppStatus: opportunities.status,
        customerTypeFrozen: opportunities.customerTypeFrozen,
        countsAsDigital: opportunities.countsAsDigital,
        accountName: accounts.name,
      })
      .from(contracts)
      .innerJoin(opportunities, eq(opportunities.id, contracts.opportunityId))
      .innerJoin(accounts, eq(accounts.id, contracts.accountId))
      .where(inArray(contracts.status, ['SIGNED', 'ACTIVE', 'EXPIRED'])),
    db
      .select({
        paidOn: payments.paidOn,
        amount: sql<string>`coalesce(${payments}.${sql.raw(`amount_${c.toLowerCase()}`)}, 0)::text`,
      })
      .from(payments),
    db
      .select({
        status: milestones.status,
        readyAt: milestones.readyAt,
        acSignedAt: milestones.acSignedAt,
        receptionAt: milestones.receptionAt,
        recognizedOn: milestones.recognizedOn,
        amount: sql<string>`coalesce(${milestones}.${sql.raw(`amount_${c.toLowerCase()}`)}, 0)::text`,
      })
      .from(milestones),
    db
      .select({
        issuedOn: invoices.issuedOn,
        dueOn: invoices.dueOn,
        balance: invoices.balance,
        currency: invoices.amountCurrency,
        amount: sql<string>`coalesce(${invoices}.${sql.raw(`amount_${c.toLowerCase()}`)}, 0)::text`,
      })
      .from(invoices),
    db
      .select({
        type: priceRequests.type,
        submittedAt: priceRequests.submittedAt,
        sheetApprovedAt: priceRequests.sheetApprovedAt,
      })
      .from(priceRequests),
    db
      .select({
        stage: opportunities.stage,
        status: opportunities.status,
        expectedCloseDate: opportunities.expectedCloseDate,
        amount: sql<string>`coalesce(${opportunities}.${sql.raw(`amount_${c.toLowerCase()}`)}, 0)::text`,
        amountUsd: opportunities.amountUsd,
        wonAt: opportunities.wonAt,
        customerType: accounts.customerType,
      })
      .from(opportunities)
      .innerJoin(accounts, eq(accounts.id, opportunities.accountId)),
    db
      .select({
        wonAt: opportunities.wonAt,
        price: sheetVersions.totalPriceExTax,
        cost: sheetVersions.totalCost,
        cc: sheetVersions.totalCommercialCosts,
        currency: sheetVersions.currency,
      })
      .from(opportunities)
      .innerJoin(approvalRequests, eq(approvalRequests.id, opportunities.currentApprovalRequestId))
      .innerJoin(sheetVersions, eq(sheetVersions.id, approvalRequests.sheetVersionId))
      .where(and(sql`${opportunities.wonAt} IS NOT NULL`, eq(approvalRequests.status, 'APPROVED'))),
    db.select().from(targets).where(eq(targets.year, year)),
    db.select({ status: tickets.status, ballIn: tickets.ballIn }).from(tickets),
  ]);

  const cnyToDisplay = (v: number | null) => {
    if (v === null) return null;
    if (cur === 'CNY') return v;
    return Number(convert(String(v), 'CNY', cur, asOf, ctx.fx).amount);
  };
  const target = (code: string, segment = 'TOTAL') => {
    const t = tgtRows.find((x) => x.kpiCode === code && x.segment === segment);
    return t?.value == null ? null : Number(t.value);
  };
  // Targets for money KPIs are stored in MM CNY → convert to display currency.
  const tMoney = (code: string, segment = 'TOTAL') => cnyToDisplay(target(code, segment));

  // KPI 1, 2, 6
  const ss = ssSigned(
    contractRows.map((r) => ({
      type: r.type,
      countsForSs: r.countsForSs,
      signedOn: r.signedOn,
      amount: r.amount,
      opportunityWon: r.stage >= 7 && r.oppStatus === 'OPEN',
      customerTypeFrozen: r.customerTypeFrozen,
      countsAsDigital: r.countsAsDigital,
    })),
    from,
    asOf,
  );
  // KPI 3, 4
  const pay = paymentsTotal(paymentRows, from, asOf);
  const recognized = recognizedRevenue(msRows, from, asOf);
  // KPI 5
  const prof = profit(
    wonRows.map((w) => {
      const d = w.wonAt!.toISOString().slice(0, 10);
      return {
        wonOn: d,
        price: toDisplay(ctx, w.price, w.currency, d, cur),
        cost: toDisplay(ctx, w.cost, w.currency, d, cur),
        commercialCosts: toDisplay(ctx, w.cc, w.currency, d, cur),
      };
    }),
    from,
    asOf,
  );
  // KPI 7
  const probs = ctx.settings['forecast.stageProbabilities'];
  const pipelineOpps = oppRows.map((o) => ({ ...o, expectedCloseDate: o.expectedCloseDate }));
  const weighted = weightedPipeline(pipelineOpps, probs, to);
  const weightedNew = weightedPipeline(
    pipelineOpps.filter((o) => o.customerType === 'NEW'),
    probs,
    to,
  );
  const ssTarget = tMoney('SS_SIGNED');
  const ssNewTarget = tMoney('SS_SIGNED', 'NEW');
  const coverage = pipelineCoverage({
    pipeline: weighted,
    target: ssTarget === null ? null : ssTarget * MM,
    signedYtd: ss.total,
  });
  const coverageNew = pipelineCoverage({
    pipeline: weightedNew,
    target: ssNewTarget === null ? null : ssNewTarget * MM,
    signedYtd: ss.newCustomers,
  });
  // KPI 8
  const pending = pendingAcceptances(
    msRows.map((m) => ({
      ...m,
      readyOn: m.readyAt ? m.readyAt.toISOString().slice(0, 10) : null,
    })),
    today,
    ctx.calendars.CL!,
    ctx.settings['kpi.pendingAcceptanceBusinessDays'],
  );
  // KPI 9 (balance converted at the invoice month)
  const aging = receivablesAging(
    invRows.map((i) => ({
      dueOn: i.dueOn,
      balance: toDisplay(ctx, i.balance, i.currency, i.issuedOn, cur),
    })),
    today,
  );
  // KPI 10 (China calendar)
  const windowFrom = addDays(today, -7 * ctx.settings['kpi.priceTimeWindowWeeks']);
  const pt = priceTime(
    prRows.map((p) => ({
      type: p.type,
      submittedOn: p.submittedAt ? p.submittedAt.toISOString().slice(0, 10) : null,
      sheetApprovedOn: p.sheetApprovedAt ? p.sheetApprovedAt.toISOString().slice(0, 10) : null,
    })),
    windowFrom,
    today,
    ctx.calendars.CN!,
    ctx.settings['sla.businessDays'].P5_PROJECT,
  );

  const covTarget = target('COVERAGE');
  const kpis = [
    {
      code: 'SS_SIGNED',
      unit: 'MM',
      value: mm(ss.total),
      target: ssTarget,
      rag: rag(mm(ss.total), ssTarget, 'PACE', { pace, amberPct: amber }),
    },
    {
      code: 'MIX_NEW_EXISTING',
      unit: 'PCT',
      value: ss.newPct,
      target: 0.5,
      rag: rag(ss.newPct, 0.5, 'MIN', { amberPct: amber }),
      detail: {
        newMm: mm(ss.newCustomers),
        existingMm: mm(ss.existingCustomers),
        newTargetMm: ssNewTarget,
        existingTargetMm: tMoney('SS_SIGNED', 'EXISTING'),
      },
    },
    {
      code: 'PAYMENTS',
      unit: 'MM',
      value: mm(pay),
      target: tMoney('PAYMENTS'),
      rag: rag(mm(pay), tMoney('PAYMENTS'), 'PACE', { pace, amberPct: amber }),
    },
    {
      code: 'RECOGNIZED_REVENUE',
      unit: 'MM',
      value: mm(recognized),
      target: null,
      rag: 'NONE',
    },
    {
      code: 'PROFIT',
      unit: 'MM',
      value: mm(prof.profit),
      target: tMoney('PROFIT'),
      rag: rag(mm(prof.profit), tMoney('PROFIT'), 'PACE', { pace, amberPct: amber }),
      detail: { pct: prof.pct },
    },
    {
      code: 'DIGITAL_SALES',
      unit: 'MM',
      value: mm(ss.digital),
      target: tMoney('DIGITAL_SALES'),
      rag: rag(mm(ss.digital), tMoney('DIGITAL_SALES'), 'PACE', { pace, amberPct: amber }),
    },
    {
      code: 'PIPELINE_COVERAGE',
      unit: 'RATIO',
      value: coverage.ratio === null ? null : Number(coverage.ratio),
      target: covTarget,
      rag: coverage.reached ? 'GREEN' : rag(coverage.ratio, covTarget, 'MIN', { amberPct: amber }),
      detail: {
        weightedMm: mm(weighted),
        newRatio: coverageNew.ratio === null ? null : Number(coverageNew.ratio),
        newRag: coverageNew.reached
          ? 'GREEN'
          : rag(coverageNew.ratio, covTarget, 'MIN', { amberPct: amber }),
        weightedNewMm: mm(weightedNew),
        reached: coverage.reached,
      },
    },
    {
      code: 'PENDING_ACCEPTANCES',
      unit: 'COUNT',
      value: pending.count,
      target: 0,
      rag: rag(pending.count, 0, 'ZERO'),
      detail: { amountMm: mm(pending.amount), allPending: pending.allPending },
    },
    {
      code: 'OVERDUE_RECEIVABLES',
      unit: 'COUNT',
      value: aging.over30.count,
      target: 0,
      rag: rag(aging.over30.count, 0, 'ZERO'),
      detail: { amountMm: mm(aging.over30.amount), buckets: aging.buckets },
    },
    {
      code: 'PRICE_TIME',
      unit: 'BUSINESS_DAYS',
      value: pt.median,
      target: ctx.settings['sla.businessDays'].P5_PROJECT,
      rag: rag(pt.median, ctx.settings['sla.businessDays'].P5_PROJECT, 'MAX', {
        amberPct: amber,
      }),
      detail: { average: pt.average, pctWithin: pt.pctWithin, count: pt.count },
    },
  ];

  // ---- Legacy "Resumen" cards (LEGACY-DASHBOARD.md) ----
  const health = await computeHealth(db, ctx, auth, today);
  const healthCounts: Record<HealthStatus, number> = {
    HEALTHY: 0,
    AT_RISK: 0,
    CRITICAL: 0,
    STALE: 0,
    ON_HOLD: 0,
    CLOSED: 0,
  };
  for (const h of health) healthCounts[h.status]++;
  let closedUsd = new Decimal(0);
  let inFlightUsd = new Decimal(0);
  let newPipelineUsd = new Decimal(0);
  for (const o of oppRows) {
    const b = legacyGoalBucket(o.stage, o.status);
    const wonThisYear = o.wonAt && o.wonAt.toISOString().slice(0, 4) === String(year);
    if (b === 'CLOSED' && wonThisYear) closedUsd = closedUsd.plus(D(o.amountUsd));
    if (b === 'IN_FLIGHT') inFlightUsd = inFlightUsd.plus(D(o.amountUsd));
    if (o.status === 'OPEN' && o.stage < 7 && o.customerType === 'NEW')
      newPipelineUsd = newPipelineUsd.plus(D(o.amountUsd));
  }
  const goalUsd =
    target('SS_SIGNED') === null
      ? null
      : Number(convert(String(target('SS_SIGNED')! * MM), 'CNY', 'USD', asOf, ctx.fx).amount);
  let toInvoice = new Decimal(0);
  // "Con OC, sin facturar" (legacy Resumen): delivered milestones not invoiced yet.
  for (const m of msRows)
    if (m.status === 'READY' || m.status === 'ACCEPTED' || m.status === 'SENT_TO_FINANCE')
      toInvoice = toInvoice.plus(D(m.amount));
  let toCollect = new Decimal(0);
  let overdueAll = new Decimal(0);
  let overdueAllCount = 0;
  let dueSoon = new Decimal(0);
  let dueSoonCount = 0;
  let invoicedYtd = new Decimal(0);
  for (const i of invRows) {
    const bal = D(toDisplay(ctx, i.balance, i.currency, i.issuedOn, cur));
    if (i.issuedOn >= from && i.issuedOn <= asOf) invoicedYtd = invoicedYtd.plus(D(i.amount));
    if (bal.lte(0)) continue;
    toCollect = toCollect.plus(bal);
    if (i.dueOn < today) {
      overdueAll = overdueAll.plus(bal);
      overdueAllCount++;
    } else if (i.dueOn <= addDays(today, ctx.settings['invoices.defaultPaymentTermDays'])) {
      dueSoon = dueSoon.plus(bal);
      dueSoonCount++;
    }
  }
  const openTickets = ticketRows.filter((t) =>
    ['OPEN', 'IN_PROGRESS', 'PENDING_CLIENT'].includes(t.status),
  );

  // ---- Charts ----
  const byStage = Array.from({ length: 9 }, (_, s) => ({ stage: s, count: 0, amountMm: 0 }));
  for (const o of oppRows) {
    if (o.status !== 'OPEN' || o.stage > 8) continue;
    byStage[o.stage]!.count++;
    byStage[o.stage]!.amountMm = mm(D(byStage[o.stage]!.amountMm).times(MM).plus(D(o.amount)));
  }
  const monthly = Array.from({ length: 12 }, (_, i) => {
    const m = `${year}-${String(i + 1).padStart(2, '0')}`;
    const mFrom = `${m}-01`;
    const mTo = `${m}-31`;
    const ssM = contractRows
      .filter(
        (r) =>
          r.signedOn &&
          r.signedOn >= mFrom &&
          r.signedOn <= mTo &&
          r.countsForSs &&
          r.type !== 'NDA' &&
          r.stage >= 7,
      )
      .reduce((a, r) => a.plus(D(r.amount)), new Decimal(0));
    return { month: m, ssMm: mm(ssM), paymentsMm: mm(paymentsTotal(paymentRows, mFrom, mTo)) };
  });

  return {
    year,
    asOf,
    currency: cur,
    pace,
    kpis,
    legacy: {
      projectsHealth: healthCounts,
      goal: {
        closedUsd: money(closedUsd),
        inFlightUsd: money(inFlightUsd),
        goalUsd,
        pct: goalUsd ? closedUsd.div(goalUsd).toDecimalPlaces(4).toNumber() : null,
        pctPotential: goalUsd
          ? closedUsd.plus(inFlightUsd).div(goalUsd).toDecimalPlaces(4).toNumber()
          : null,
      },
      newPipelineUsd: money(newPipelineUsd),
      toInvoice: money(toInvoice),
      toCollect: money(toCollect),
      overdue: { amount: money(overdueAll), count: overdueAllCount },
      dueSoon: { amount: money(dueSoon), count: dueSoonCount },
      openIncidents: openTickets.length,
      incidentsBallInWhale: openTickets.filter((t) => t.ballIn === 'WHALE').length,
    },
    charts: {
      pipelineByStage: byStage,
      funnel: [
        { step: 'SIGNED', amountMm: mm(ss.total) },
        { step: 'ACCEPTED', amountMm: mm(recognized) },
        { step: 'INVOICED', amountMm: mm(invoicedYtd) },
        { step: 'COLLECTED', amountMm: mm(pay) },
      ],
      monthly,
    },
  };
}
