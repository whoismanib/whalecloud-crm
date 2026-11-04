import { addBusinessDays, addDays, daysBetween, type BusinessCalendar } from './businessDays';
import { D, Decimal, money, type Numeric, type RuleFailure } from './common';
import type { CapacityAlert } from '../enums';
import type { Settings } from '../schemas/settings';

// ---------- P9 hand-off ----------

export const HANDOFF_CHECKLIST = [
  'commercialSheetReviewed',
  'sowReviewed',
  'milestonesReviewed',
  'acceptanceCriteriaReviewed',
] as const;
export type HandoffChecklistKey = (typeof HANDOFF_CHECKLIST)[number];

/** Hand-off meeting due 5 business days ⚙ after signature (P9-01). */
export function handoffDueOn(signedOn: string, cal: BusinessCalendar, days: number): string {
  return addBusinessDays(signedOn, days, cal);
}

/** Meeting must review commercial sheet, SOW, milestones and acceptance criteria (P9-01). */
export function handoffChecklistMissing(
  h: Partial<Record<HandoffChecklistKey, boolean | null>>,
): HandoffChecklistKey[] {
  return HANDOFF_CHECKLIST.filter((k) => !h[k]);
}

/** KPI P9 "inicio a tiempo": meeting within SLA and actual start ≤ planned start. */
export function handoffOnTime(h: {
  dueOn: string | null;
  meetingOn: string | null;
  plannedStart: string | null;
  actualStart: string | null;
}): boolean | null {
  if (!h.meetingOn || !h.actualStart || !h.plannedStart) return null;
  return (!h.dueOn || h.meetingOn <= h.dueOn) && h.actualStart <= h.plannedStart;
}

// ---------- P10 accounts & renewals ----------

/** Renewal opportunity created at T−90 and quote due at T−60 (P10-03/04), calendar days. */
export function renewalDates(
  endDate: string,
  settings: Pick<Settings, 'renewals'>,
): { createOn: string; quoteBy: string } {
  return {
    createOn: addDays(endDate, -settings.renewals.createDaysBefore),
    quoteBy: addDays(endDate, -settings.renewals.quoteDaysBefore),
  };
}

export type RenewalAlert = 'NONE' | 'CREATE_OPPORTUNITY' | 'QUOTE_OVERDUE';

export function renewalAlert(
  r: {
    createOn: string;
    quoteBy: string;
    hasOpportunity: boolean;
    quoted: boolean;
    closed: boolean;
  },
  today: string,
): RenewalAlert {
  if (r.closed || r.quoted) return 'NONE';
  if (today >= r.quoteBy) return 'QUOTE_OVERDUE';
  if (today >= r.createOn && !r.hasOpportunity) return 'CREATE_OPPORTUNITY';
  return 'NONE';
}

/** First day of the quarter containing `date`. */
export function quarterStart(date: string): string {
  const m = Number(date.slice(5, 7));
  const q = Math.floor((m - 1) / 3) * 3 + 1;
  return `${date.slice(0, 4)}-${String(q).padStart(2, '0')}-01`;
}

export function previousQuarterStart(date: string): string {
  return quarterStart(addDays(quarterStart(date), -1));
}

/**
 * P10-02: a key account is overdue when the last closed quarter has no QUARTERLY review.
 * Returns the quarters (start dates) missing per account.
 */
export function overdueQuarterlyReviews(
  keyAccountIds: readonly string[],
  reviews: ReadonlyArray<{ accountId: string; kind: string; periodStart: string }>,
  today: string,
): { accountId: string; periodStart: string }[] {
  const q = previousQuarterStart(today);
  return keyAccountIds
    .filter(
      (id) =>
        !reviews.some((r) => r.accountId === id && r.kind === 'QUARTERLY' && r.periodStart === q),
    )
    .map((accountId) => ({ accountId, periodStart: q }));
}

/** Monthly eDo review stats from tickets (P10-02). */
export function edoTicketStats(
  tickets: ReadonlyArray<{
    status: string;
    priority: string;
    slaDueOn: string | null;
    ballIn: string;
  }>,
  today: string,
) {
  const open = tickets.filter((t) => ['OPEN', 'IN_PROGRESS', 'PENDING_CLIENT'].includes(t.status));
  return {
    open: open.length,
    critical: open.filter((t) => t.priority === 'P1').length,
    slaOverdue: open.filter((t) => t.slaDueOn !== null && t.slaDueOn < today).length,
    ballInWhale: open.filter((t) => t.ballIn === 'WHALE').length,
    ballInClient: open.filter((t) => t.ballIn === 'CLIENT').length,
  };
}

// ---------- P11 change requests ----------

export interface RateCard {
  id?: string;
  profile: string;
  rate: Numeric;
  currency: string;
  validFrom: string;
  validTo: string | null;
}

/** Rate card valid for a profile on a date (latest valid_from wins). */
export function findRate(
  cards: ReadonlyArray<RateCard>,
  profile: string,
  date: string,
): RateCard | null {
  const valid = cards
    .filter(
      (c) =>
        c.profile.toLowerCase() === profile.toLowerCase() &&
        c.validFrom <= date &&
        (c.validTo === null || c.validTo >= date),
    )
    .sort((a, b) => (a.validFrom < b.validFrom ? 1 : -1));
  return valid[0] ?? null;
}

/** P11-01: amount = hours × profile rate, per line; failures when a profile has no rate. */
export function quoteCr(
  lines: ReadonlyArray<{ profile: string; hours: Numeric }>,
  cards: ReadonlyArray<RateCard>,
  date: string,
): {
  lines: {
    profile: string;
    hours: string;
    rate: string | null;
    amount: string | null;
    rateCardId: string | null;
  }[];
  total: string;
  currency: string | null;
  failures: RuleFailure[];
} {
  const failures: RuleFailure[] = [];
  let total = new Decimal(0);
  let currency: string | null = null;
  const out = lines.map((l) => {
    const card = findRate(cards, l.profile, date);
    if (!card) {
      failures.push({ code: 'RATE_CARD_MISSING', params: { profile: l.profile } });
      return {
        profile: l.profile,
        hours: D(l.hours).toFixed(2),
        rate: null,
        amount: null,
        rateCardId: null,
      };
    }
    if (currency && card.currency !== currency) {
      failures.push({ code: 'RATE_CARD_CURRENCY_MIX', params: { profile: l.profile } });
    }
    currency = currency ?? card.currency;
    const amount = D(l.hours).times(D(card.rate));
    total = total.plus(amount);
    return {
      profile: l.profile,
      hours: D(l.hours).toFixed(2),
      rate: money(card.rate),
      amount: money(amount),
      rateCardId: card.id ?? null,
    };
  });
  if (lines.length === 0) failures.push({ code: 'CR_LINES_REQUIRED' });
  return { lines: out, total: money(total), currency, failures };
}

/** P11-02: no CR work without a PO, unless a valid CM exception exists. */
export function canStartWork(
  cr: { poReceivedOn: string | null; cmException: boolean; exceptionExpiresOn: string | null },
  today: string,
): RuleFailure[] {
  if (cr.poReceivedOn) return [];
  if (cr.cmException) {
    if (cr.exceptionExpiresOn && cr.exceptionExpiresOn < today) {
      return [{ code: 'CR_EXCEPTION_EXPIRED', params: { expiresOn: cr.exceptionExpiresOn } }];
    }
    return [];
  }
  return [{ code: 'PO_REQUIRED' }];
}

// ---------- P16 resident capacity ----------

/** P16-02: consumption of a PO; alert at 80 % ⚙ and critical at 100 %; excess counts as "sin OC". */
export function poConsumption(
  consumedHours: Numeric,
  poHours: Numeric,
  threshold: number,
): { pct: number; alert: CapacityAlert; excessHours: string; remainingHours: string } {
  const c = D(consumedHours);
  const t = D(poHours);
  const pct = t.isZero() ? 1 : c.div(t).toDecimalPlaces(4).toNumber();
  const alert: CapacityAlert = pct >= 1 ? 'CRITICAL_100' : pct >= threshold ? 'WARN_80' : 'NONE';
  const excess = Decimal.max(0, c.minus(t));
  return {
    pct,
    alert,
    excessHours: excess.toFixed(2),
    remainingHours: Decimal.max(0, t.minus(c)).toFixed(2),
  };
}

/** P16-03: months left at the average monthly burn (null when nothing consumed). */
export function exhaustionProjection(
  monthlyHours: ReadonlyArray<Numeric>,
  remainingHours: Numeric,
): number | null {
  if (!monthlyHours.length) return null;
  const avg = monthlyHours
    .reduce<Decimal>((a, h) => a.plus(D(h)), new Decimal(0))
    .div(monthlyHours.length);
  if (avg.lte(0)) return null;
  return D(remainingHours).div(avg).toDecimalPlaces(1).toNumber();
}

// ---------- P15 onboarding ----------

/** P15-02: calendar days from joining to the first registered opportunity. */
export function daysToFirstOpportunity(
  startDate: string,
  firstOpportunityOn: string | null,
): number | null {
  return firstOpportunityOn ? daysBetween(startDate, firstOpportunityOn) : null;
}

/** P15-01: overdue when past the productive target with pending items. */
export function onboardingOverdue(
  c: { startDate: string; pendingItems: number; productiveAt: string | null },
  today: string,
  settings: Pick<Settings, 'onboarding.productiveDays'>,
): boolean {
  if (c.productiveAt || c.pendingItems === 0) return false;
  return today > addDays(c.startDate, settings['onboarding.productiveDays']);
}
