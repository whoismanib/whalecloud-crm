import type { EngagementStatus, TicketStatus, TopicState } from '../enums';

/**
 * Engagement score per topic ("Salud CRM" of the legacy dashboard, ADR 0008). Faithful port of
 * `~/.hermes/scripts/crm_scoring.py`: recency (40) + volume (30) + two-way dialogue (30) over a
 * 30-day window, calendar days in UTC, a meeting weighs as two e-mails, STALE after 14 days with
 * no meeting scheduled. The account score is the plain mean of its ACTIVE topics, rounded like
 * Python's `round` (half to even).
 */

const DAY_MS = 86_400_000;
/** Days without a past interaction are reported as 999, like the legacy script. */
export const NO_INTERACTION_DAYS = 999;
export const STALE_CALENDAR_DAYS = 14;

/** 40 points max, decays with the days since the last interaction. */
export function recencyPoints(days: number): number {
  if (days <= 2) return 40;
  if (days <= 5) return 34;
  if (days <= 7) return 28;
  if (days <= 14) return 18;
  if (days <= 21) return 10;
  if (days <= 30) return 5;
  return 0;
}

/** 30 points max, volume of interactions (e-mails + 2 × meetings). */
export function activityPoints(interactions: number): number {
  if (interactions <= 0) return 0;
  if (interactions === 1) return 8;
  if (interactions <= 3) return 15;
  if (interactions <= 6) return 22;
  if (interactions <= 10) return 27;
  return 30;
}

/** 30 points max, two-way dialogue: a meeting is the strongest signal; one-way mail is weak. */
export function engagementPoints(inbox: number, sent: number, meetings = 0): number {
  if (meetings > 0 && (inbox > 0 || sent > 0)) return 30;
  if (meetings > 0) return 26;
  if (inbox > 0 && sent > 0) {
    const ratio = Math.min(inbox, sent) / Math.max(inbox, sent);
    return Math.trunc(22 + ratio * 8);
  }
  if (inbox > 0 || sent > 0) return 10;
  return 0;
}

/** Whole calendar days between two instants (floor, never negative); 999 when there is none. */
export function daysSince(at: string | null, now: string): number {
  if (!at) return NO_INTERACTION_DAYS;
  const ms = Date.parse(now) - Date.parse(at);
  if (Number.isNaN(ms)) return NO_INTERACTION_DAYS;
  return Math.max(0, Math.floor(ms / DAY_MS));
}

/** Python 3 `round()` for non-negative means: half to even. */
export function roundHalfEven(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (Math.abs(d - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1;
  return Math.round(x);
}

export interface EngagementTicket {
  number: string;
  status: TicketStatus;
  /** Last update of the ticket (ISO datetime). */
  lastUpdateAt: string | null;
}

export interface EngagementInput {
  /** Received e-mails in the window. */
  inbox: number;
  /** Sent e-mails in the window. */
  sent: number;
  /** Past meetings in the window. */
  meetings: number;
  /** Scheduled (future) meetings. */
  upcoming: number;
  /** Last past e-mail or meeting (ISO datetime), null when none in the window. */
  lastAt: string | null;
  state: TopicState;
  /** eDo tickets linked to the topic (legacy `edo` refs), if they are in the CRM. */
  tickets?: EngagementTicket[];
  /** "Now" (ISO datetime). Rules never read the clock (ADR 0006). */
  now: string;
}

export interface EngagementResult {
  score: number;
  status: EngagementStatus;
  /** Days since the last interaction (999 = none). */
  lastDays: number;
  /** Everything that keeps the topic from being dormant (past + scheduled + open tickets). */
  total: number;
  /** Counts for the account average (legacy `total > 0` and not On Hold/Closed/Resolved). */
  active: boolean;
  breakdown: { recency: number; activity: number; engagement: number };
  reason: { code: string; params?: Record<string, number | string> } | null;
}

const OPEN_TICKET = (t: EngagementTicket) => t.status !== 'RESOLVED' && t.status !== 'CLOSED';
const INACTIVE: readonly EngagementStatus[] = ['ON_HOLD', 'CLOSED', 'RESOLVED'];

function statusLabel(
  score: number,
  days: number,
  hasActivity: boolean,
  upcoming: number,
  onHold: boolean,
): EngagementStatus {
  if (onHold) return 'ON_HOLD';
  if (!hasActivity) return upcoming > 0 ? 'SCHEDULED' : 'DORMANT';
  if (days > STALE_CALENDAR_DAYS && upcoming === 0) return 'STALE';
  if (score >= 70) return 'HEALTHY';
  if (score >= 40) return 'AT_RISK';
  return 'CRITICAL';
}

export function engagementScore(input: EngagementInput): EngagementResult {
  const inbox = Math.max(0, input.inbox);
  const sent = Math.max(0, input.sent);
  const meetings = Math.max(0, input.meetings);
  const upcoming = Math.max(0, input.upcoming);
  const past = inbox + sent + meetings;
  let total = past + upcoming;
  const hasActivity = past > 0;
  let lastDays = hasActivity ? daysSince(input.lastAt, input.now) : NO_INTERACTION_DAYS;
  const interactions = inbox + sent + meetings * 2;
  const recency = hasActivity ? recencyPoints(lastDays) : 0;
  const activity = hasActivity ? activityPoints(interactions) : 0;
  const engagement = engagementPoints(inbox, sent, meetings);
  let score = Math.min(100, recency + activity + engagement);
  if (!hasActivity && upcoming > 0) score = 30; // only a meeting scheduled: alive, no traction yet
  let status = statusLabel(score, lastDays, hasActivity, upcoming, input.state === 'ON_HOLD');
  let reason: EngagementResult['reason'] = null;

  const tickets = input.tickets ?? [];
  if (tickets.length) {
    const open = tickets.filter(OPEN_TICKET);
    if (!open.length) {
      status = tickets.every((t) => t.status === 'CLOSED') ? 'CLOSED' : 'RESOLVED';
      reason = { code: status === 'CLOSED' ? 'TICKETS_CLOSED' : 'TICKETS_RESOLVED' };
    } else {
      const last = open.reduce((a, t) => ((t.lastUpdateAt ?? '') > (a.lastUpdateAt ?? '') ? t : a));
      const ed = daysSince(last.lastUpdateAt, input.now);
      reason = { code: 'TICKET_OPEN', params: { number: last.number, days: ed } };
      if (!hasActivity) {
        // No mail: the ticket drives the topic.
        total += open.length;
        score = Math.min(100, recencyPoints(ed) + 20);
        lastDays = Math.min(lastDays, ed);
        status = ed <= STALE_CALENDAR_DAYS ? 'IN_PROGRESS' : 'STALE';
      }
    }
  }
  if (input.state === 'CLOSED') {
    status = 'CLOSED';
    reason = { code: 'TOPIC_CLOSED' };
  } else if (input.state === 'ON_HOLD' && !reason) {
    reason = { code: 'TOPIC_ON_HOLD' };
  } else if (status === 'DORMANT') {
    reason = { code: 'NO_INTERACTION_WINDOW' };
  } else if (status === 'STALE' && !reason) {
    reason = { code: 'IDLE_DAYS', params: { days: lastDays } };
  }
  return {
    score,
    status,
    lastDays,
    total,
    active: total > 0 && !INACTIVE.includes(status),
    breakdown: { recency, activity, engagement },
    reason,
  };
}

export interface AccountEngagementInput {
  inbox: number;
  sent: number;
  meetings: number;
  upcoming: number;
  result: EngagementResult;
}

export interface AccountEngagement {
  /** Mean of active topics (0 when none), like the legacy client score. */
  score: number;
  activeCount: number;
  totalCount: number;
  emails: number;
  meetings: number;
  upcoming: number;
  onHold: number;
  closed: number;
}

/** Legacy client roll-up (`crm_scoring.py` `avg_active` and the client summary). */
export function accountEngagement(topics: readonly AccountEngagementInput[]): AccountEngagement {
  const active = topics.filter((t) => t.result.active);
  return {
    score: active.length
      ? roundHalfEven(active.reduce((a, t) => a + t.result.score, 0) / active.length)
      : 0,
    activeCount: active.length,
    totalCount: topics.length,
    emails: topics.reduce((a, t) => a + t.inbox + t.sent, 0),
    meetings: topics.reduce((a, t) => a + t.meetings, 0),
    upcoming: topics.reduce((a, t) => a + t.upcoming, 0),
    onHold: topics.filter((t) => t.result.status === 'ON_HOLD').length,
    closed: topics.filter((t) => t.result.status === 'CLOSED' || t.result.status === 'RESOLVED')
      .length,
  };
}

export interface EngagementSummary {
  active: number;
  healthy: number;
  atRisk: number;
  critical: number;
  stale: number;
  onHold: number;
}

/** Legacy Resumen cards "Proyectos activos CRM" (bands over active topics) and "Stale / On Hold". */
export function engagementSummary(results: readonly EngagementResult[]): EngagementSummary {
  const active = results.filter((r) => r.active);
  return {
    active: active.length,
    healthy: active.filter((r) => r.score >= 70).length,
    atRisk: active.filter((r) => r.score >= 40 && r.score < 70).length,
    critical: active.filter((r) => r.score < 40).length,
    stale: results.filter((r) => r.status === 'STALE').length,
    onHold: results.filter((r) => r.status === 'ON_HOLD').length,
  };
}
