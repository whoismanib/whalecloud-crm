import { businessDaysBetween, type BusinessCalendar } from './businessDays';
import type { HealthStatus, OpportunityStatus, RiskLevel } from '../enums';
import type { Settings } from '../schemas/settings';

export interface HealthInput {
  status: OpportunityStatus;
  stage: number;
  onHold?: boolean;
  /** Last activity (meeting/call/email) date, YYYY-MM-DD. */
  lastActivityOn: string | null;
  /** Last update of the record, YYYY-MM-DD. */
  lastUpdatedOn: string;
  expectedCloseDate: string | null;
  overdueSlaCount: number;
  risk: RiskLevel | null;
  today: string;
  /**
   * E-mails and meetings of the last 30 days (ADR 0008). Optional: without it the score only uses
   * the last activity date, as before the mail import.
   */
  engagement?: EngagementCounts;
}

export interface EngagementCounts {
  emailsIn: number;
  emailsOut: number;
  meetings: number;
  /** Meetings scheduled in the future. */
  upcoming: number;
}

export interface HealthResult {
  score: number | null;
  status: HealthStatus;
  reasons: { code: string; points: number; params?: Record<string, number | string> }[];
  idleBusinessDays: number;
}

/** Thresholds of the legacy "Salud CRM" page: healthy ≥ 70, at risk 40–69, critical < 40. */
export function healthBand(score: number): Exclude<HealthStatus, 'STALE' | 'ON_HOLD' | 'CLOSED'> {
  if (score >= 70) return 'HEALTHY';
  if (score >= 40) return 'AT_RISK';
  return 'CRITICAL';
}

/**
 * Health score 0–100 for an opportunity/project from recent activity, close date, overdue SLAs
 * and declared risk. STALE when idle longer than `health.staleBusinessDays` (business days).
 */
export function healthScore(
  input: HealthInput,
  cal: BusinessCalendar,
  settings: Pick<Settings, 'health.staleBusinessDays'>,
): HealthResult {
  const last =
    input.lastActivityOn && input.lastActivityOn > input.lastUpdatedOn
      ? input.lastActivityOn
      : input.lastUpdatedOn;
  const idle = Math.max(0, businessDaysBetween(last, input.today, cal));
  if (input.status !== 'OPEN' || input.stage >= 11) {
    return { score: null, status: 'CLOSED', reasons: [], idleBusinessDays: idle };
  }
  if (input.onHold) return { score: null, status: 'ON_HOLD', reasons: [], idleBusinessDays: idle };

  const reasons: HealthResult['reasons'] = [];
  if (idle > 20) reasons.push({ code: 'IDLE', points: -40, params: { days: idle } });
  else if (idle > 10) reasons.push({ code: 'IDLE', points: -25, params: { days: idle } });
  else if (idle > 5) reasons.push({ code: 'IDLE', points: -10, params: { days: idle } });
  if (!input.lastActivityOn) reasons.push({ code: 'NO_ACTIVITY', points: -10 });
  if (input.stage < 7 && input.expectedCloseDate && input.expectedCloseDate < input.today) {
    reasons.push({
      code: 'CLOSE_DATE_PASSED',
      points: -20,
      params: { date: input.expectedCloseDate },
    });
  }
  if (input.overdueSlaCount > 0) {
    reasons.push({
      code: 'SLA_OVERDUE',
      points: -Math.min(45, 15 * input.overdueSlaCount),
      params: { count: input.overdueSlaCount },
    });
  }
  if (input.risk === 'HIGH') reasons.push({ code: 'RISK_HIGH', points: -20 });
  else if (input.risk === 'MEDIUM') reasons.push({ code: 'RISK_MEDIUM', points: -10 });
  const e = input.engagement;
  if (e) {
    const mail = e.emailsIn + e.emailsOut;
    if (mail + e.meetings === 0 && e.upcoming === 0 && input.lastActivityOn) {
      reasons.push({ code: 'NO_ENGAGEMENT_30D', points: -10 });
    } else if (e.emailsIn > 0 && e.emailsOut === 0 && e.meetings === 0) {
      reasons.push({ code: 'ONE_WAY', points: -5, params: { count: e.emailsIn } });
    }
    if (e.meetings > 0)
      reasons.push({ code: 'MEETING_30D', points: 5, params: { count: e.meetings } });
  }

  const score = Math.max(0, Math.min(100, 100 + reasons.reduce((a, r) => a + r.points, 0)));
  // A meeting on the calendar means the deal is alive (legacy: Stale only with no meeting scheduled).
  const scheduled = (e?.upcoming ?? 0) > 0;
  const status: HealthStatus =
    idle > settings['health.staleBusinessDays'] && !scheduled ? 'STALE' : healthBand(score);
  return { score, status, reasons, idleBusinessDays: idle };
}
