import type { ComplianceAnswer, RfpDecision, RfpResult } from '../enums';
import type { Settings } from '../schemas/settings';
import { addBusinessDays, subtractBusinessDays, type BusinessCalendar } from './businessDays';
import type { RuleFailure } from './common';

/**
 * P3-01 / P3-02: participate/decline decision due 2 business days ⚙ after reception; internal
 * milestone 5 business days ⚙ before the client deadline.
 */
export function rfpDates(
  receivedOn: string,
  clientDeadline: string,
  cal: BusinessCalendar,
  settings: Pick<Settings, 'sla.businessDays'>,
): { decisionDueOn: string; internalDeadline: string } {
  const sla = settings['sla.businessDays'];
  return {
    decisionDueOn: addBusinessDays(receivedOn, sla.P3_DECISION, cal),
    internalDeadline: subtractBusinessDays(clientDeadline, sla.P3_INTERNAL_BEFORE_DEADLINE, cal),
  };
}

export function rfpDateFailures(receivedOn: string, clientDeadline: string): RuleFailure[] {
  return clientDeadline < receivedOn ? [{ code: 'DATE_RANGE_INVALID' }] : [];
}

/** P3-03: % of requirements that comply (partial counts half); PENDING counts as not answered. */
export function rfpCompliance(answers: readonly ComplianceAnswer[]): {
  total: number;
  answered: number;
  pct: number | null;
} {
  const total = answers.length;
  const answered = answers.filter((a) => a !== 'PENDING').length;
  if (!total) return { total, answered, pct: null };
  const score = answers.reduce((s, a) => s + (a === 'COMPLIES' ? 1 : a === 'PARTIAL' ? 0.5 : 0), 0);
  return { total, answered, pct: Math.round((score / total) * 10000) / 10000 };
}

export interface RfpState {
  decision: RfpDecision;
  decisionDueOn: string;
  decidedOn?: string | null;
  internalDeadline: string;
  clientDeadline: string;
  cmReviewedAt?: string | null;
  deliveredOn?: string | null;
  result: RfpResult;
}

/** P3-04: delivery needs a participate decision, the full matrix answered and the CM review. */
export function rfpDeliverFailures(
  rfp: Pick<RfpState, 'decision' | 'cmReviewedAt' | 'deliveredOn'>,
  pendingRequirements: number,
): RuleFailure[] {
  const f: RuleFailure[] = [];
  if (rfp.deliveredOn) f.push({ code: 'RFP_ALREADY_DELIVERED' });
  if (rfp.decision !== 'PARTICIPATE') f.push({ code: 'RFP_DECISION_REQUIRED' });
  if (pendingRequirements > 0)
    f.push({ code: 'RFP_REQUIREMENTS_PENDING', params: { count: pendingRequirements } });
  if (!rfp.cmReviewedAt) f.push({ code: 'RFP_CM_REVIEW_REQUIRED' });
  return f;
}

/** Alerts used by the SLA scan and the list: decision overdue (P3-01), internal milestone (P3-02). */
export function rfpAlerts(
  rfp: Pick<
    RfpState,
    'decision' | 'decisionDueOn' | 'internalDeadline' | 'deliveredOn' | 'clientDeadline'
  >,
  today: string,
): ('DECISION_OVERDUE' | 'INTERNAL_DUE' | 'INTERNAL_OVERDUE' | 'CLIENT_DEADLINE_MISSED')[] {
  const out: (
    | 'DECISION_OVERDUE'
    | 'INTERNAL_DUE'
    | 'INTERNAL_OVERDUE'
    | 'CLIENT_DEADLINE_MISSED'
  )[] = [];
  if (rfp.decision === 'PENDING' && today > rfp.decisionDueOn) out.push('DECISION_OVERDUE');
  if (rfp.decision === 'PARTICIPATE' && !rfp.deliveredOn) {
    if (today > rfp.clientDeadline) out.push('CLIENT_DEADLINE_MISSED');
    else if (today > rfp.internalDeadline) out.push('INTERNAL_OVERDUE');
    else if (today === rfp.internalDeadline) out.push('INTERNAL_DUE');
  }
  return out;
}

/**
 * KPIS.md §4 P3: "RFPs a tiempo" = delivered on or before the client deadline / delivered, and
 * decisions within 2 business days / decided; "tasa de adjudicación" = won / (won + lost).
 */
export function rfpKpis(rfps: readonly RfpState[]): {
  delivered: number;
  onTimePct: number | null;
  decided: number;
  decisionOnTimePct: number | null;
  withResult: number;
  winRate: number | null;
} {
  const ratio = (n: number, d: number) => (d ? Math.round((n / d) * 10000) / 10000 : null);
  const delivered = rfps.filter((r) => r.deliveredOn);
  const onTime = delivered.filter((r) => r.deliveredOn! <= r.clientDeadline).length;
  const decided = rfps.filter((r) => r.decision !== 'PENDING' && r.decidedOn);
  const decisionOnTime = decided.filter((r) => r.decidedOn! <= r.decisionDueOn).length;
  const won = rfps.filter((r) => r.result === 'WON').length;
  const lost = rfps.filter((r) => r.result === 'LOST').length;
  return {
    delivered: delivered.length,
    onTimePct: ratio(onTime, delivered.length),
    decided: decided.length,
    decisionOnTimePct: ratio(decisionOnTime, decided.length),
    withResult: won + lost,
    winRate: ratio(won, won + lost),
  };
}
