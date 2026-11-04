import { addBusinessDays, isoWeek, previousFriday, renewalAlert, rfpAlerts } from '@wcrm/shared';
import { and, eq, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
import type { Actor } from '../audit/record';
import {
  approvalRequests,
  approvalSteps,
  collectionActions,
  contracts,
  handoffs,
  invoices,
  milestones,
  opportunities,
  priceRequests,
  renewals,
  rfps,
} from '../db/schema/index';
import { notify } from '../services/notify';
import type { AppContext, AuthInfo } from '../types';
import { createRenewalOpportunity, syncRenewals } from '../modules/accounts/postsale.routes';
import { recomputeCapacity } from '../modules/capacity/routes';
import { takeSnapshot } from '../modules/forecast/routes';
import { listOnboarding } from '../modules/onboarding/routes';

const SYSTEM: Actor = { userId: null, roles: [] };
const SYSTEM_AUTH: AuthInfo = {
  sessionId: 'system',
  csrfToken: '',
  mfaVerified: true,
  user: {
    id: '00000000-0000-0000-0000-000000000000',
    email: 'system',
    fullName: 'Sistema',
    locale: 'es-CL',
    timezone: 'America/Santiago',
    calendarId: 'CL',
    countryCodes: ['*'],
    mfaEnabled: false,
  },
  roles: ['COUNTRY_MANAGER', 'LATAM_PRESIDENT'],
};

type JobFn = (ctx: AppContext, today: string) => Promise<Record<string, unknown>>;

/** SLA breach / due-soon alerts (ADM-11) for P3, P5, P6, P8 (AC, invoice) and P9. */
const slaScan: JobFn = async ({ db, rules, mailer }, today) => {
  const r = await rules.get();
  const soon = addBusinessDays(today, 1, r.calendars.CL!);
  let n = 0;
  const prs = await db
    .select({
      id: priceRequests.id,
      due: priceRequests.slaDueOn,
      oppId: priceRequests.opportunityId,
      ownerId: opportunities.ownerId,
      name: opportunities.name,
    })
    .from(priceRequests)
    .innerJoin(opportunities, eq(opportunities.id, priceRequests.opportunityId))
    .where(
      and(
        inArray(priceRequests.status, ['SUBMITTED', 'COSTING', 'BUILDING', 'READY_FOR_APPROVAL']),
        lte(priceRequests.slaDueOn, soon),
      ),
    );
  for (const p of prs) {
    const overdue = p.due! < today;
    n += await notify(
      db,
      {
        userIds: [p.ownerId],
        roles: overdue ? ['CHINA_SALES', 'COUNTRY_MANAGER'] : ['CHINA_SALES'],
        type: 'SLA',
        titleKey: overdue ? 'slaPriceOverdue' : 'slaPriceDueSoon',
        params: { name: p.name, due: p.due },
        entityType: 'opportunity',
        entityId: p.oppId,
        link: `/oportunidades/${p.oppId}`,
        dedupeKey: `sla:pr:${p.id}:${overdue ? 'overdue' : 'soon'}`,
      },
      mailer,
    );
  }
  const steps = await db
    .select({
      id: approvalSteps.id,
      due: approvalSteps.dueOn,
      role: approvalSteps.assigneeRole,
      user: approvalSteps.assigneeUserId,
      oppId: approvalRequests.opportunityId,
    })
    .from(approvalSteps)
    .innerJoin(approvalRequests, eq(approvalRequests.id, approvalSteps.approvalRequestId))
    .where(and(eq(approvalSteps.status, 'PENDING'), lt(approvalSteps.dueOn, today)));
  for (const s of steps) {
    n += await notify(
      db,
      {
        userIds: s.user ? [s.user] : [],
        roles: s.user ? ['COUNTRY_MANAGER'] : [s.role, 'COUNTRY_MANAGER'],
        type: 'SLA',
        titleKey: 'slaApprovalOverdue',
        params: { due: s.due },
        entityType: 'opportunity',
        entityId: s.oppId,
        link: '/aprobaciones',
        dedupeKey: `sla:step:${s.id}`,
      },
      mailer,
    );
  }
  const acs = await db
    .select({
      id: milestones.id,
      name: milestones.name,
      due: milestones.acDueOn,
      oppId: milestones.opportunityId,
    })
    .from(milestones)
    .where(and(eq(milestones.status, 'READY'), lt(milestones.acDueOn, today)));
  for (const m of acs) {
    n += await notify(
      db,
      {
        roles: ['ACCOUNT_MANAGER', 'COUNTRY_MANAGER'],
        type: 'SLA',
        titleKey: 'slaAcceptanceOverdue',
        params: { name: m.name, due: m.due },
        entityType: 'opportunity',
        entityId: m.oppId,
        link: `/oportunidades/${m.oppId}`,
        dedupeKey: `sla:ac:${m.id}`,
      },
      mailer,
    );
  }
  const invs = await db
    .select({
      id: milestones.id,
      name: milestones.name,
      due: milestones.invoiceDueOn,
      oppId: milestones.opportunityId,
    })
    .from(milestones)
    .where(and(eq(milestones.status, 'SENT_TO_FINANCE'), lt(milestones.invoiceDueOn, today)));
  for (const m of invs) {
    n += await notify(
      db,
      {
        roles: ['CHINA_FINANCE', 'COUNTRY_MANAGER'],
        type: 'SLA',
        titleKey: 'slaInvoiceOverdue',
        params: { name: m.name, due: m.due },
        entityType: 'opportunity',
        entityId: m.oppId,
        link: '/facturacion',
        dedupeKey: `sla:inv:${m.id}`,
      },
      mailer,
    );
  }
  // P9-01: won and signed, no hand-off meeting within 5 business days of signature
  const won = await db
    .select({
      oppId: opportunities.id,
      name: opportunities.name,
      signedOn: sql<string>`max(${contracts.signedOn})::text`,
    })
    .from(opportunities)
    .innerJoin(contracts, eq(contracts.opportunityId, opportunities.id))
    .leftJoin(handoffs, eq(handoffs.opportunityId, opportunities.id))
    .where(
      and(
        eq(opportunities.stage, 7),
        eq(opportunities.status, 'OPEN'),
        isNull(handoffs.id),
        sql`${contracts.signedOn} IS NOT NULL`,
      ),
    )
    .groupBy(opportunities.id, opportunities.name);
  for (const w of won) {
    const due = addBusinessDays(
      w.signedOn,
      r.settings['sla.businessDays'].P9_HANDOFF,
      r.calendars.CL!,
    );
    if (due >= today) continue;
    n += await notify(
      db,
      {
        roles: ['COUNTRY_MANAGER', 'LOCAL_DELIVERY', 'CHINA_DELIVERY'],
        type: 'SLA',
        titleKey: 'slaHandoffOverdue',
        params: { name: w.name, due },
        entityType: 'opportunity',
        entityId: w.oppId,
        link: `/oportunidades/${w.oppId}`,
        dedupeKey: `sla:handoff:${w.oppId}`,
      },
      mailer,
    );
  }
  // P3-01 decision not taken in 2 business days → AM + CM; P3-02 internal milestone → AM + China Sales
  const open = await db
    .select({ r: rfps, ownerId: opportunities.ownerId })
    .from(rfps)
    .innerJoin(opportunities, eq(opportunities.id, rfps.opportunityId))
    .where(and(isNull(rfps.deliveredOn), inArray(rfps.decision, ['PENDING', 'PARTICIPATE'])));
  for (const { r: x, ownerId } of open) {
    for (const alert of rfpAlerts(x, today)) {
      n += await notify(
        db,
        {
          userIds: [ownerId],
          roles: alert === 'DECISION_OVERDUE' ? ['COUNTRY_MANAGER'] : ['CHINA_SALES'],
          type: 'SLA',
          titleKey: `rfp.${alert}`,
          params: {
            title: x.title,
            due:
              alert === 'DECISION_OVERDUE'
                ? x.decisionDueOn
                : alert === 'CLIENT_DEADLINE_MISSED'
                  ? x.clientDeadline
                  : x.internalDeadline,
          },
          entityType: 'rfp',
          entityId: x.id,
          link: '/preventa',
          dedupeKey: `sla:rfp:${x.id}:${alert}`,
        },
        mailer,
      );
    }
  }
  return { notifications: n };
};

/** P8-06: notify the responsible role on each due escalation step (−10/+1/+7/+15/+30). */
const collectionsDaily: JobFn = async ({ db, mailer }, today) => {
  const due = await db
    .select({
      a: collectionActions,
      number: invoices.number,
      balance: invoices.balance,
      oppId: milestones.opportunityId,
    })
    .from(collectionActions)
    .innerJoin(invoices, eq(invoices.id, collectionActions.invoiceId))
    .innerJoin(milestones, eq(milestones.id, invoices.milestoneId))
    .where(
      and(
        eq(collectionActions.status, 'PENDING'),
        lte(collectionActions.scheduledOn, today),
        isNull(collectionActions.notifiedAt),
        sql`${invoices.balance} > 0`,
      ),
    );
  let n = 0;
  for (const d of due) {
    n += await notify(
      db,
      {
        userIds: d.a.assigneeUserId ? [d.a.assigneeUserId] : [],
        roles: [d.a.responsibleRole, ...d.a.notifiedRoles],
        type: 'COLLECTION',
        titleKey: `collection.${d.a.step}`,
        params: { invoice: d.number, balance: d.balance },
        entityType: 'invoice',
        entityId: d.a.invoiceId,
        link: '/facturacion',
        dedupeKey: `collections:${d.a.jobKey}`,
      },
      mailer,
    );
    await db
      .update(collectionActions)
      .set({ notifiedAt: new Date() })
      .where(eq(collectionActions.id, d.a.id));
  }
  return { steps: due.length, notifications: n };
};

/** P10-03/04: renewal opportunity at T−90, alert to quote at T−60. */
const renewalsDaily: JobFn = async (ctx, today) => {
  const { db, rules, mailer } = ctx;
  const r = await rules.get();
  const created = await syncRenewals(db, r);
  const rows = await db
    .select({
      rn: renewals,
      stage: opportunities.stage,
      status: opportunities.status,
      title: contracts.title,
      ownerId: opportunities.ownerId,
    })
    .from(renewals)
    .innerJoin(contracts, eq(contracts.id, renewals.contractId))
    .leftJoin(opportunities, eq(opportunities.id, renewals.renewalOpportunityId));
  let opps = 0;
  let alerts = 0;
  for (const x of rows) {
    if (x.stage !== null && x.stage >= 5 && !x.rn.quotedAt) {
      await db
        .update(renewals)
        .set({ quotedAt: new Date(), status: 'QUOTED' })
        .where(eq(renewals.id, x.rn.id));
      continue;
    }
    const alert = renewalAlert(
      {
        createOn: x.rn.createOn,
        quoteBy: x.rn.quoteBy,
        hasOpportunity: Boolean(x.rn.renewalOpportunityId),
        quoted: Boolean(x.rn.quotedAt),
        closed:
          ['RENEWED', 'NOT_RENEWED'].includes(x.rn.status) ||
          (x.status !== null && x.status !== 'OPEN'),
      },
      today,
    );
    if (
      alert === 'CREATE_OPPORTUNITY' ||
      (alert === 'QUOTE_OVERDUE' && !x.rn.renewalOpportunityId)
    ) {
      const id = await db.transaction((tx) => createRenewalOpportunity(tx, x.rn.id, SYSTEM, today));
      opps++;
      alerts += await notify(
        db,
        {
          roles: ['ACCOUNT_MANAGER'],
          type: 'RENEWAL',
          titleKey: 'renewalCreated',
          params: { contract: x.title, endDate: x.rn.endDate },
          entityType: 'opportunity',
          entityId: id,
          link: `/oportunidades/${id}`,
          dedupeKey: `renewal:${x.rn.id}:t90`,
        },
        mailer,
      );
    }
    if (alert === 'QUOTE_OVERDUE') {
      alerts += await notify(
        db,
        {
          roles: ['ACCOUNT_MANAGER', 'COUNTRY_MANAGER'],
          type: 'RENEWAL',
          titleKey: 'renewalQuoteOverdue',
          params: { contract: x.title, quoteBy: x.rn.quoteBy },
          entityType: 'renewal',
          entityId: x.rn.id,
          link: '/renovaciones',
          dedupeKey: `renewal:${x.rn.id}:t60`,
        },
        mailer,
      );
    }
  }
  return { scheduled: created, opportunities: opps, notifications: alerts };
};

const capacityDaily: JobFn = async ({ db, rules, mailer }) => ({
  notifications: await recomputeCapacity(db, await rules.get(), mailer),
});

/** ADM-10: daily hash-chain verification; admins are alerted when it breaks. */
const auditVerify: JobFn = async ({ db, mailer }) => {
  const r = await db.execute<{ checked: string; first_broken_id: string | null }>(
    sql`SELECT checked::text, first_broken_id::text FROM audit_log_verify()`,
  );
  const row = r.rows[0]!;
  if (row.first_broken_id) {
    await notify(
      db,
      {
        roles: ['ADMIN'],
        type: 'SECURITY',
        titleKey: 'auditBroken',
        params: { id: row.first_broken_id },
        link: '/bitacora',
        dedupeKey: `audit:broken:${row.first_broken_id}`,
      },
      mailer,
    );
  }
  return { ok: row.first_broken_id === null, checked: Number(row.checked) };
};

/** P12-02 Monday: opportunities not updated since the previous Friday → owner + CM. */
const forecastMonday: JobFn = async ({ db, mailer }, today) => {
  const friday = previousFriday(today);
  const stale = await db
    .select({ id: opportunities.id, name: opportunities.name, ownerId: opportunities.ownerId })
    .from(opportunities)
    .where(
      and(
        eq(opportunities.status, 'OPEN'),
        sql`${opportunities.stage} BETWEEN 1 AND 7`,
        sql`${opportunities.updatedAt}::date <= ${friday}::date`,
        sql`coalesce(${opportunities.lastActivityAt}::date, '1900-01-01') <= ${friday}::date`,
      ),
    );
  const w = isoWeek(today);
  let n = 0;
  for (const o of stale) {
    n += await notify(
      db,
      {
        userIds: [o.ownerId],
        roles: ['COUNTRY_MANAGER'],
        type: 'FORECAST',
        titleKey: 'forecastStale',
        params: { name: o.name },
        entityType: 'opportunity',
        entityId: o.id,
        link: `/oportunidades/${o.id}`,
        dedupeKey: `forecast:stale:${w.year}-${w.week}:${o.id}`,
      },
      mailer,
    );
  }
  return { stale: stale.length, notifications: n };
};

/** P12-03 Wednesday snapshot (skipped when it already exists). */
const forecastSnapshot: JobFn = async (ctx, today) => {
  try {
    const id = await takeSnapshot(ctx.db, await ctx.rules.get(), SYSTEM_AUTH, SYSTEM, today);
    return { snapshotId: id };
  } catch (e) {
    if ((e as { code?: string }).code === 'DUPLICATE') return { skipped: true };
    throw e;
  }
};

/** P15-01: people past their productive target with pending items → CM. */
const onboardingDaily: JobFn = async ({ db, rules, mailer }, today) => {
  const list = await listOnboarding(db, await rules.get(), today);
  let n = 0;
  for (const c of list.filter((x) => x.overdue)) {
    n += await notify(
      db,
      {
        roles: ['COUNTRY_MANAGER'],
        type: 'ONBOARDING',
        titleKey: 'onboardingOverdue',
        params: { name: c.fullName },
        link: '/incorporacion',
        dedupeKey: `onboarding:${c.id}:overdue`,
      },
      mailer,
    );
  }
  return { overdue: list.filter((x) => x.overdue).length, notifications: n };
};

/** Job registry (ARCHITECTURE §3.3): cron in America/Santiago. */
export const JOBS = {
  'sla.scan': { cron: '0 * * * *', description: 'SLA por vencer / vencidos', run: slaScan },
  'collections.daily': {
    cron: '0 8 * * *',
    description: 'Escalamiento de cobranza',
    run: collectionsDaily,
  },
  'renewals.daily': {
    cron: '0 7 * * *',
    description: 'Renovaciones T−90 / T−60',
    run: renewalsDaily,
  },
  'capacity.daily': {
    cron: '30 8 * * *',
    description: 'Consumo OC residentes (80 %)',
    run: capacityDaily,
  },
  'audit.verify': { cron: '0 3 * * *', description: 'Verificación de bitácora', run: auditVerify },
  'forecast.monday': {
    cron: '0 18 * * 1',
    description: 'Oportunidades sin actualizar',
    run: forecastMonday,
  },
  'forecast.snapshot': {
    cron: '0 9 * * 3',
    description: 'Snapshot semanal',
    run: forecastSnapshot,
  },
  'onboarding.daily': {
    cron: '0 8 * * *',
    description: 'Incorporación atrasada',
    run: onboardingDaily,
  },
} as const satisfies Record<string, { cron: string; description: string; run: JobFn }>;

export type JobName = keyof typeof JOBS;

export async function runJob(name: JobName, ctx: AppContext, today: string) {
  const started = Date.now();
  const result = await JOBS[name].run(ctx, today);
  return { name, today, ms: Date.now() - started, result };
}
