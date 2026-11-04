import {
  businessDaysBetween,
  daysBetween,
  median,
  processKpiRag,
  rfpKpis,
  share,
  type ProcessKpiDirection,
} from '@wcrm/shared';
import { sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import type { RulesContext } from '../../services/rulesContext';
import type { AuthInfo } from '../../types';
import { listOnboarding } from '../onboarding/routes';
import { forecastAccuracyFor } from '../forecast/routes';
import { listRfps } from '../rfps/routes';
import { computeDashboard } from './routes';

export interface ProcessKpi {
  process: string;
  code: string;
  unit: 'PCT' | 'COUNT' | 'DAYS' | 'CNY' | 'NUMBER';
  value: number | null;
  target: number | null;
  rag: string;
  detail?: Record<string, unknown>;
  /** false = KPI defined in KPIS.md §4 whose source data the app does not capture yet. */
  available: boolean;
}

const rows = async <T>(db: Db, q: ReturnType<typeof sql>) => (await db.execute(q)).rows as T[];

/**
 * DASH-05: KPIs per process P1–P16 (KPIS.md §4), year to date of `today` unless stated. Values
 * are computed from operational data; KPIs whose source data is not captured are returned with
 * `available: false` so the tab lists them explicitly.
 */
export async function computeProcessKpis(
  db: Db,
  ctx: RulesContext,
  auth: AuthInfo,
  today: string,
): Promise<ProcessKpi[]> {
  const year = today.slice(0, 4);
  const from = `${year}-01-01`;
  const month = `${today.slice(0, 7)}-01`;
  const cal = ctx.calendars.CL!;
  const out: ProcessKpi[] = [];
  const add = (
    process: string,
    code: string,
    unit: ProcessKpi['unit'],
    value: number | null,
    target: number | null,
    dir: ProcessKpiDirection,
    detail?: Record<string, unknown>,
  ) =>
    out.push({
      process,
      code,
      unit,
      value,
      target,
      rag: processKpiRag(value, target, dir),
      detail,
      available: true,
    });
  const pending = (process: string, code: string, unit: ProcessKpi['unit']) =>
    out.push({ process, code, unit, value: null, target: null, rag: 'NONE', available: false });

  // P1 — registration within 2 business days; new pipeline this month
  const [p1] = await rows<{ n: number; late: number }>(
    db,
    sql`SELECT count(*)::int n, count(*) FILTER (WHERE registered_late)::int late
        FROM opportunities WHERE created_at >= ${from}::date`,
  );
  add('P1', 'P1_REGISTERED_ON_TIME', 'PCT', share(p1!.n - p1!.late, p1!.n), 1, 'MIN', {
    created: p1!.n,
  });
  const [p1m] = await rows<{ n: number; cny: string }>(
    db,
    sql`SELECT count(*)::int n, coalesce(sum(amount_cny),0)::text cny
        FROM opportunities WHERE created_at >= ${month}::date`,
  );
  add('P1', 'P1_NEW_PIPELINE_MONTH', 'CNY', Number(p1m!.cny), null, 'NONE', { count: p1m!.n });

  // P2 — MEDDPICC ≥ 50 % on deals above the threshold from stage 2; stage conversion pending
  const threshold = ctx.settings['qualification.meddpiccThresholdUsd'];
  const minScore = ctx.settings['qualification.meddpiccMinScore'];
  const [p2] = await rows<{ n: number; ok: number }>(
    db,
    sql`SELECT count(*)::int n,
               count(*) FILTER (WHERE coalesce(q.meddpicc_score,0) >= ${minScore})::int ok
        FROM opportunities o LEFT JOIN opportunity_qualifications q ON q.opportunity_id = o.id
        WHERE o.status = 'OPEN' AND o.stage >= 2 AND o.amount_usd > ${threshold}`,
  );
  add('P2', 'P2_MEDDPICC', 'PCT', share(p2!.ok, p2!.n), 1, 'MIN', { deals: p2!.n });
  pending('P2', 'P2_STAGE_CONVERSION', 'PCT');

  // P3 — RFPs on time, decision in 2 business days, win rate
  const k3 = rfpKpis(await listRfps(db, auth, ctx, today));
  add('P3', 'P3_RFP_ON_TIME', 'PCT', k3.onTimePct, 1, 'MIN', { delivered: k3.delivered });
  add('P3', 'P3_DECISION_ON_TIME', 'PCT', k3.decisionOnTimePct, 1, 'MIN', { decided: k3.decided });
  add('P3', 'P3_WIN_RATE', 'PCT', k3.winRate, null, 'NONE', { withResult: k3.withResult });

  // P4 — close rate with and without business case
  const p4 = await rows<{ uses: boolean; won: number; closed: number }>(
    db,
    sql`SELECT uses_business_case uses,
               count(*) FILTER (WHERE won_at IS NOT NULL)::int won, count(*)::int closed
        FROM opportunities
        WHERE (won_at >= ${from}::date) OR (status <> 'OPEN' AND closed_at >= ${from}::date)
        GROUP BY uses_business_case`,
  );
  const w = p4.find((r) => r.uses);
  const wo = p4.find((r) => !r.uses);
  add('P4', 'P4_CLOSE_RATE_WITH_CASE', 'PCT', w ? share(w.won, w.closed) : null, null, 'NONE');
  add(
    'P4',
    'P4_CLOSE_RATE_WITHOUT_CASE',
    'PCT',
    wo ? share(wo.won, wo.closed) : null,
    null,
    'NONE',
  );

  // P5 — response time (= KPI 10) and versions per request; P8 overdue (= KPI 9)
  const dash = await computeDashboard(db, ctx, auth, today, {});
  const kpi = (code: string) => dash.kpis.find((k) => k.code === code);
  const priceTime = kpi('PRICE_TIME');
  add('P5', 'P5_RESPONSE_DAYS', 'DAYS', priceTime?.value ?? null, priceTime?.target ?? 10, 'MAX');
  const [p5] = await rows<{ avg: string | null; n: number }>(
    db,
    sql`SELECT avg(c)::text avg, count(*)::int n FROM (
          SELECT count(*) c FROM sheet_versions GROUP BY price_request_id) x`,
  );
  add(
    'P5',
    'P5_VERSIONS',
    'NUMBER',
    p5!.avg === null ? null : Number(Number(p5!.avg).toFixed(2)),
    null,
    'NONE',
    {
      requests: p5!.n,
    },
  );

  // P6 — approval resolved in ≤ 3 business days; deals won without a valid approval
  const p6 = await rows<{ req: string; res: string }>(
    db,
    sql`SELECT requested_at::date::text req, resolved_at::date::text res FROM approval_requests
        WHERE resolved_at IS NOT NULL AND requested_at >= ${from}::date`,
  );
  const sla6 = ctx.settings['sla.businessDays'].P6_APPROVAL;
  add(
    'P6',
    'P6_APPROVAL_ON_TIME',
    'PCT',
    share(p6.filter((r) => businessDaysBetween(r.req, r.res, cal) <= sla6).length, p6.length),
    1,
    'MIN',
    { resolved: p6.length },
  );
  const [p6b] = await rows<{ n: number }>(
    db,
    sql`SELECT count(*)::int n FROM opportunities o
        WHERE o.won_at >= ${from}::date AND NOT EXISTS (
          SELECT 1 FROM approval_requests a WHERE a.opportunity_id = o.id AND a.status = 'APPROVED')`,
  );
  add('P6', 'P6_OUT_OF_POLICY', 'COUNT', p6b!.n, 0, 'ZERO');

  // P7 — signed contract available in the repository within 2 business days
  const p7 = await rows<{ signed: string; loaded: string }>(
    db,
    sql`SELECT c.signed_on::text signed, a.created_at::date::text loaded
        FROM contracts c JOIN attachments a ON a.id = c.signed_attachment_id
        WHERE c.signed_on >= ${from}::date`,
  );
  add(
    'P7',
    'P7_REPOSITORY_48H',
    'PCT',
    share(
      p7.filter((r) => r.loaded <= r.signed || businessDaysBetween(r.signed, r.loaded, cal) <= 2)
        .length,
      p7.length,
    ),
    1,
    'MIN',
    { signed: p7.length },
  );
  pending('P7', 'P7_LEGAL_ON_TIME', 'PCT');

  // P8 — overdue receivables (= KPI 9) and days to collect
  const overdue = kpi('OVERDUE_RECEIVABLES');
  add('P8', 'P8_OVERDUE_RECEIVABLES', 'CNY', overdue?.value ?? null, 0, 'ZERO');
  const p8 = await rows<{ issued: string; paid: string }>(
    db,
    sql`SELECT i.issued_on::text issued, max(p.paid_on)::text paid
        FROM invoices i JOIN payments p ON p.invoice_id = i.id
        WHERE i.balance = 0 AND i.issued_on >= ${`${Number(year) - 1}-01-01`}::date
        GROUP BY i.id, i.issued_on`,
  );
  const dso = p8.map((r) => daysBetween(r.issued, r.paid));
  add(
    'P8',
    'P8_DAYS_TO_COLLECT',
    'DAYS',
    dso.length ? Math.round(dso.reduce((a, b) => a + b, 0) / dso.length) : null,
    60,
    'MAX',
    { invoices: dso.length, median: median(dso) },
  );

  // P9 — hand-off within 5 business days and start on plan
  const p9 = await rows<{
    due: string | null;
    meeting: string | null;
    planned: string | null;
    actual: string | null;
  }>(
    db,
    sql`SELECT due_on::text due, meeting_at::date::text meeting, planned_start::text planned,
               actual_start::text actual FROM handoffs WHERE created_at >= ${from}::date`,
  );
  const ok9 = p9.filter(
    (h) =>
      h.meeting &&
      h.due &&
      h.meeting <= h.due &&
      (!h.actual || !h.planned || h.actual <= h.planned),
  ).length;
  add('P9', 'P9_ON_TIME', 'PCT', share(ok9, p9.length), 1, 'MIN', { handoffs: p9.length });

  // P10 — renewals quoted ≥ 60 days before the end
  const [p10] = await rows<{ due: number; ok: number }>(
    db,
    sql`SELECT count(*)::int due,
               count(*) FILTER (WHERE quoted_at IS NOT NULL AND quoted_at::date <= quote_by)::int ok
        FROM renewals WHERE quote_by <= ${today}::date OR quoted_at IS NOT NULL`,
  );
  add('P10', 'P10_RENEWALS_QUOTED_T60', 'PCT', share(p10!.ok, p10!.due), 1, 'MIN', {
    renewals: p10!.due,
  });
  pending('P10', 'P10_ACCOUNT_GROWTH', 'PCT');

  // P11 — CR value with PO this month; work without PO
  const [p11] = await rows<{ cny: string; nopo: number }>(
    db,
    sql`SELECT coalesce(sum(amount_cny) FILTER (WHERE po_received_on >= ${month}::date),0)::text cny,
               count(*) FILTER (WHERE status = 'IN_PROGRESS' AND po_received_on IS NULL)::int nopo
        FROM change_requests`,
  );
  add('P11', 'P11_CR_VALUE_MONTH', 'CNY', Number(p11!.cny), null, 'NONE');
  add('P11', 'P11_WORK_WITHOUT_PO', 'COUNT', p11!.nopo, 0, 'ZERO');

  // P12 — forecast accuracy for the current quarter
  const q = `${year}Q${Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1}`;
  const acc = await forecastAccuracyFor(db, ctx, q);
  add(
    'P12',
    'P12_FORECAST_ACCURACY',
    'PCT',
    acc.deviation,
    ctx.settings['forecast.accuracyTolerance'],
    'BAND',
    { period: q, snapshotOn: acc.snapshotOn },
  );

  // P13 — open pipeline through distributors
  const [p13] = await rows<{ n: number; cny: string }>(
    db,
    sql`SELECT count(*)::int n, coalesce(sum(amount_cny),0)::text cny FROM opportunities
        WHERE status = 'OPEN' AND distributor_id IS NOT NULL`,
  );
  add('P13', 'P13_DISTRIBUTOR_PIPELINE', 'CNY', Number(p13!.cny), null, 'NONE', { count: p13!.n });

  // P14 — proposals sent (stage ≥ 5) with an approved checklist; audit findings pending
  const [p14] = await rows<{ n: number; ok: number }>(
    db,
    sql`SELECT count(*)::int n, count(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM compliance_checklists c WHERE c.opportunity_id = o.id AND c.status = 'APPROVED'))::int ok
        FROM opportunities o
        WHERE o.stage >= 5 AND o.created_at >= ${from}::date`,
  );
  add('P14', 'P14_CHECKLIST_BEFORE_PROPOSAL', 'PCT', share(p14!.ok, p14!.n), 1, 'MIN', {
    proposals: p14!.n,
  });
  pending('P14', 'P14_AUDIT_FINDINGS', 'COUNT');

  // P15 — days from start to the first opportunity
  const onb = (await listOnboarding(db, ctx, today))
    .map((o) => o.daysToFirstOpportunity)
    .filter((d): d is number => d !== null);
  add(
    'P15',
    'P15_DAYS_TO_FIRST_OPP',
    'DAYS',
    onb.length ? Math.round(onb.reduce((a, b) => a + b, 0) / onb.length) : null,
    ctx.settings['onboarding.productiveDays'],
    'MAX',
    { people: onb.length },
  );

  // P16 — hours without PO this month and POs at ≥ 80 %
  const [p16] = await rows<{ hours: string; warn: number }>(
    db,
    sql`SELECT (SELECT coalesce(sum(excess_hours),0) FROM hours_entries
              WHERE month = (SELECT max(month) FROM hours_entries) AND without_po)::text hours,
            (SELECT count(*)::int FROM resident_pos WHERE alert_level <> 'NONE') warn`,
  );
  add('P16', 'P16_HOURS_WITHOUT_PO', 'NUMBER', Number(p16!.hours), 0, 'ZERO');
  add('P16', 'P16_PO_OVER_80', 'COUNT', p16!.warn, 0, 'ZERO');

  return out;
}
