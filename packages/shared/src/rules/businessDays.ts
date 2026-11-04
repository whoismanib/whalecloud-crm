/**
 * Business-day calendar arithmetic on ISO calendar dates (YYYY-MM-DD), timezone-free.
 * A calendar = weekend days (0 = Sunday … 6 = Saturday) + holidays + optional extra working
 * days (China "调休" make-up Saturdays/Sundays).
 */
export interface BusinessCalendar {
  weekend: number[];
  holidays: ReadonlySet<string> | readonly string[];
  extraWorkdays?: ReadonlySet<string> | readonly string[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function assertIsoDate(d: string): void {
  if (!ISO_DATE.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) {
    throw new RangeError(`Invalid ISO date: ${d}`);
  }
}

function toUtc(d: string): Date {
  assertIsoDate(d);
  return new Date(`${d}T00:00:00Z`);
}

function fromUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function has(set: ReadonlySet<string> | readonly string[] | undefined, d: string): boolean {
  if (!set) return false;
  return set instanceof Set ? set.has(d) : (set as readonly string[]).includes(d);
}

/** Adds calendar days (may be negative). */
export function addDays(date: string, n: number): string {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUtc(d);
}

/** Calendar days from a to b (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000);
}

export function isBusinessDay(date: string, cal: BusinessCalendar): boolean {
  if (has(cal.extraWorkdays, date)) return true;
  const dow = toUtc(date).getUTCDay();
  if (cal.weekend.includes(dow)) return false;
  return !has(cal.holidays, date);
}

/** Moves n business days forward (n > 0) or backward (n < 0). n = 0 returns the date itself. */
export function addBusinessDays(date: string, n: number, cal: BusinessCalendar): string {
  if (!Number.isInteger(n)) throw new RangeError('n must be an integer');
  let cur = date;
  let remaining = Math.abs(n);
  const step = n >= 0 ? 1 : -1;
  while (remaining > 0) {
    cur = addDays(cur, step);
    if (isBusinessDay(cur, cal)) remaining--;
  }
  return cur;
}

export function subtractBusinessDays(date: string, n: number, cal: BusinessCalendar): string {
  return addBusinessDays(date, -n, cal);
}

/**
 * Business days elapsed from a (exclusive) to b (inclusive). Negative when b < a.
 * Example: Mon → next Mon = 5.
 */
export function businessDaysBetween(a: string, b: string, cal: BusinessCalendar): number {
  if (a === b) return 0;
  const forward = daysBetween(a, b) > 0;
  const [from, to] = forward ? [a, b] : [b, a];
  let count = 0;
  let cur = from;
  while (cur !== to) {
    cur = addDays(cur, 1);
    if (isBusinessDay(cur, cal)) count++;
  }
  return forward ? count : -count;
}

/** SLAs given in hours are expressed in business days (48 h = 2), rounding up. */
export function hoursToBusinessDays(hours: number): number {
  if (hours < 0) throw new RangeError('hours must be ≥ 0');
  return Math.ceil(hours / 24);
}

/** First day of the month of an ISO date. */
export function monthOf(date: string): string {
  assertIsoDate(date);
  return `${date.slice(0, 7)}-01`;
}
