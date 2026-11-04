import { D, Decimal, type Numeric, type RuleFailure } from './common';
import type { MilestoneStatus, MilestoneTrigger } from '../enums';

export interface PctMilestone {
  seq: number;
  pct: Numeric;
  trigger: MilestoneTrigger;
}

/** Payment milestones must add up to exactly 100 % (P5-02). */
export function sumsTo100(list: ReadonlyArray<{ pct: Numeric }>): boolean {
  if (list.length === 0) return false;
  const total = list.reduce((acc, m) => acc.plus(D(m.pct)), new Decimal(0));
  return total.eq(100);
}

export function milestonesFailures(list: ReadonlyArray<{ pct: Numeric }>): RuleFailure[] {
  if (sumsTo100(list)) return [];
  const total = list.reduce((acc, m) => acc.plus(D(m.pct)), new Decimal(0));
  return [{ code: 'MILESTONES_NOT_100', params: { total: total.toFixed(2) } }];
}

export interface MilestoneDiff {
  seq: number;
  field: 'missing_in_cashflow' | 'missing_in_tc' | 'pct' | 'trigger';
  cashflow: string | null;
  tc: string | null;
}

/**
 * Cash-flow (A3) milestones must equal T&C milestones — same count, % and trigger (P7-02).
 * Equifiber: cash flow 20/20/50/10 vs T&C 30/50/20 → not equal.
 */
export function compareCashflowVsTc(
  cashflow: ReadonlyArray<PctMilestone>,
  tc: ReadonlyArray<PctMilestone>,
): { equal: boolean; diffs: MilestoneDiff[] } {
  const a = [...cashflow].sort((x, y) => x.seq - y.seq);
  const b = [...tc].sort((x, y) => x.seq - y.seq);
  const diffs: MilestoneDiff[] = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const c = a[i];
    const t = b[i];
    const seq = c?.seq ?? t?.seq ?? i + 1;
    if (!c) {
      diffs.push({ seq, field: 'missing_in_cashflow', cashflow: null, tc: D(t!.pct).toFixed(2) });
      continue;
    }
    if (!t) {
      diffs.push({ seq, field: 'missing_in_tc', cashflow: D(c.pct).toFixed(2), tc: null });
      continue;
    }
    if (!D(c.pct).eq(D(t.pct))) {
      diffs.push({ seq, field: 'pct', cashflow: D(c.pct).toFixed(2), tc: D(t.pct).toFixed(2) });
    }
    if (c.trigger !== t.trigger) {
      diffs.push({ seq, field: 'trigger', cashflow: c.trigger, tc: t.trigger });
    }
  }
  return { equal: diffs.length === 0, diffs };
}

/**
 * Commercial stage 8–11 derived from milestones = minimum state among non-cancelled ones
 * (CORE-06). 1 collected + 2 accepted → 9 (Aceptada).
 */
export function deriveStageFromMilestones(statuses: ReadonlyArray<MilestoneStatus>): number {
  const active = statuses.filter((s) => s !== 'CANCELLED');
  if (active.length === 0) return 8;
  const rank = (s: MilestoneStatus): number => {
    switch (s) {
      case 'PAID':
        return 11;
      case 'INVOICED':
      case 'PARTIALLY_PAID':
        return 10;
      case 'ACCEPTED':
      case 'SENT_TO_FINANCE':
        return 9;
      default:
        return 8;
    }
  };
  return Math.min(...active.map(rank));
}

/** Recognition date = max(AC date, reception date); null until both exist (KPI 4). */
export function recognitionDate(
  acSignedAt: string | null,
  receptionAt: string | null,
): string | null {
  if (!acSignedAt || !receptionAt) return null;
  return acSignedAt > receptionAt ? acSignedAt : receptionAt;
}
