import { businessDaysBetween, daysBetween, type BusinessCalendar } from './businessDays';
import { agingBucket, type AgingBucket } from './collections';
import { D, Decimal, money, type Numeric } from './common';
import type { ContractType, CustomerType } from '../enums';

// Formulas of KPIS.md §3 over already-filtered row sets (amounts already in the display currency).

export type Rag = 'GREEN' | 'AMBER' | 'RED' | 'NONE';

function inRange(d: string | null, from: string, to: string): d is string {
  return d !== null && d >= from && d <= to;
}

export interface SsContractRow {
  type: ContractType;
  countsForSs: boolean;
  signedOn: string | null;
  amount: Numeric;
  opportunityWon: boolean;
  customerTypeFrozen: CustomerType | null;
  countsAsDigital: boolean;
}

/** KPI 1, 2, 6: S&S signed (SOW/OC/CR, MSA only if flagged; NDA never), mix and digital. */
export function ssSigned(rows: ReadonlyArray<SsContractRow>, from: string, to: string) {
  let total = new Decimal(0);
  let newC = new Decimal(0);
  let digital = new Decimal(0);
  for (const r of rows) {
    if (r.type === 'NDA' || !r.countsForSs || !r.opportunityWon) continue;
    if (!inRange(r.signedOn, from, to)) continue;
    const a = D(r.amount);
    total = total.plus(a);
    if (r.customerTypeFrozen === 'NEW') newC = newC.plus(a);
    if (r.countsAsDigital) digital = digital.plus(a);
  }
  const existing = total.minus(newC);
  return {
    total: money(total),
    newCustomers: money(newC),
    existingCustomers: money(existing),
    newPct: total.isZero() ? null : newC.div(total).toDecimalPlaces(4).toNumber(),
    digital: money(digital),
  };
}

/** KPI 3: Σ payments in period. */
export function paymentsTotal(
  rows: ReadonlyArray<{ paidOn: string; amount: Numeric }>,
  from: string,
  to: string,
): string {
  return money(
    rows
      .filter((r) => inRange(r.paidOn, from, to))
      .reduce((a, r) => a.plus(D(r.amount)), new Decimal(0)),
  );
}

/** KPI 4: Σ milestones whose recognition date (max(AC, reception)) falls in the period. */
export function recognizedRevenue(
  rows: ReadonlyArray<{ recognizedOn: string | null; amount: Numeric }>,
  from: string,
  to: string,
): string {
  return money(
    rows
      .filter((r) => inRange(r.recognizedOn, from, to))
      .reduce((a, r) => a.plus(D(r.amount)), new Decimal(0)),
  );
}

/** KPI 5: Σ (price − cost − commercial costs) of the approved version of won opportunities. */
export function profit(
  rows: ReadonlyArray<{
    wonOn: string | null;
    price: Numeric;
    cost: Numeric;
    commercialCosts: Numeric;
  }>,
  from: string,
  to: string,
): { profit: string; pct: number | null } {
  let p = new Decimal(0);
  let price = new Decimal(0);
  for (const r of rows) {
    if (!inRange(r.wonOn, from, to)) continue;
    p = p.plus(D(r.price).minus(D(r.cost)).minus(D(r.commercialCosts)));
    price = price.plus(D(r.price));
  }
  return {
    profit: money(p),
    pct: price.isZero() ? null : p.div(price).toDecimalPlaces(4).toNumber(),
  };
}

/** KPI 8: milestones ready, missing AC or reception, older than N business days. */
export function pendingAcceptances(
  rows: ReadonlyArray<{
    readyOn: string | null;
    acSignedAt: string | null;
    receptionAt: string | null;
    amount: Numeric;
  }>,
  today: string,
  cal: BusinessCalendar,
  thresholdBusinessDays: number,
): { count: number; amount: string; allPending: number } {
  let count = 0;
  let all = 0;
  let amount = new Decimal(0);
  for (const r of rows) {
    if (!r.readyOn || (r.acSignedAt && r.receptionAt)) continue;
    all++;
    if (businessDaysBetween(r.readyOn, today, cal) > thresholdBusinessDays) {
      count++;
      amount = amount.plus(D(r.amount));
    }
  }
  return { count, amount: money(amount), allPending: all };
}

/** KPI 9: receivables with balance > 0 by aging bucket; "vencida" = > 30 calendar days. */
export function receivablesAging(
  rows: ReadonlyArray<{ dueOn: string; balance: Numeric }>,
  today: string,
) {
  const buckets: Record<AgingBucket, { count: number; amount: string }> = {
    CURRENT: { count: 0, amount: '0.00' },
    '1-7': { count: 0, amount: '0.00' },
    '8-15': { count: 0, amount: '0.00' },
    '16-30': { count: 0, amount: '0.00' },
    '30+': { count: 0, amount: '0.00' },
  };
  for (const r of rows) {
    if (D(r.balance).lte(0)) continue;
    const b = agingBucket(daysBetween(r.dueOn, today));
    buckets[b].count++;
    buckets[b].amount = money(D(buckets[b].amount).plus(D(r.balance)));
  }
  return { over30: buckets['30+'], buckets };
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** KPI 10: business days from A1 submission to approved sheet, project requests closed in window. */
export function priceTime(
  rows: ReadonlyArray<{
    type: 'PROJECT' | 'CR';
    submittedOn: string | null;
    sheetApprovedOn: string | null;
  }>,
  windowFrom: string,
  today: string,
  cal: BusinessCalendar,
  targetDays = 10,
  type: 'PROJECT' | 'CR' = 'PROJECT',
): { median: number | null; average: number | null; pctWithin: number | null; count: number } {
  const days = rows
    .filter(
      (r) =>
        r.type === type &&
        r.submittedOn &&
        r.sheetApprovedOn &&
        r.sheetApprovedOn >= windowFrom &&
        r.sheetApprovedOn <= today,
    )
    .map((r) => businessDaysBetween(r.submittedOn!, r.sheetApprovedOn!, cal));
  if (!days.length) return { median: null, average: null, pctWithin: null, count: 0 };
  const avg = days.reduce((a, b) => a + b, 0) / days.length;
  return {
    median: median(days),
    average: Math.round(avg * 10) / 10,
    pctWithin: Math.round((days.filter((d) => d <= targetDays).length / days.length) * 1000) / 1000,
    count: days.length,
  };
}

/** Fraction of the year elapsed by ISO weeks (KPIS §3: meta × semanas transcurridas / 52). */
export function yearPace(today: string): number {
  const year = today.slice(0, 4);
  const days = daysBetween(`${year}-01-01`, today) + 1;
  return Math.min(1, Math.floor(days / 7) / 52);
}

/**
 * Traffic light (KPIS §3): growth KPIs vs linear pace (green ≥ pace, amber ≥ 85 % of pace);
 * zero-target KPIs green only at 0; "max" KPIs (≤ target) green when below; no target → NONE.
 */
export function rag(
  value: Numeric | null,
  target: Numeric | null,
  kind: 'PACE' | 'ZERO' | 'MAX' | 'MIN',
  opts: { pace?: number; amberPct?: number } = {},
): Rag {
  if (value === null) return 'NONE';
  const v = D(value);
  if (kind === 'ZERO') return v.isZero() ? 'GREEN' : 'RED';
  if (target === null) return 'NONE';
  const t = D(target);
  const amber = opts.amberPct ?? 0.85;
  if (kind === 'MAX') return v.lte(t) ? 'GREEN' : v.lte(t.div(amber)) ? 'AMBER' : 'RED';
  if (kind === 'MIN') return v.gte(t) ? 'GREEN' : v.gte(t.times(amber)) ? 'AMBER' : 'RED';
  const expected = t.times(opts.pace ?? 1);
  if (v.gte(expected)) return 'GREEN';
  if (v.gte(expected.times(amber))) return 'AMBER';
  return 'RED';
}
