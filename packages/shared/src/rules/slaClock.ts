import { addBusinessDays, businessDaysBetween, type BusinessCalendar } from './businessDays';

export type SlaStatus = 'ON_TRACK' | 'DUE_SOON' | 'OVERDUE' | 'DONE' | 'DONE_LATE';

export interface SlaInput {
  /** Calendar date when the clock starts (YYYY-MM-DD). */
  start: string;
  /** Business days allowed. */
  days: number;
  calendar: BusinessCalendar;
  today: string;
  /** Whole business days the clock was paused (e.g. "esperando Chile", P5-08). */
  pausedBusinessDays?: number;
  /** Completion date if the SLA work is done. */
  doneOn?: string | null;
  /** Business days before due that count as "due soon" (ADM-11: 1). */
  dueSoonDays?: number;
}

export interface SlaOutput {
  dueDate: string;
  elapsedBusinessDays: number;
  remainingBusinessDays: number;
  status: SlaStatus;
}

/** Business-day SLA clock with pauses (ARCHITECTURE §8 slaClock). */
export function computeSla(input: SlaInput): SlaOutput {
  const paused = Math.max(0, Math.floor(input.pausedBusinessDays ?? 0));
  const dueDate = addBusinessDays(input.start, input.days + paused, input.calendar);
  const end = input.doneOn ?? input.today;
  const elapsed = Math.max(0, businessDaysBetween(input.start, end, input.calendar) - paused);
  const remaining = businessDaysBetween(input.today, dueDate, input.calendar);
  let status: SlaStatus;
  if (input.doneOn) {
    status = input.doneOn <= dueDate ? 'DONE' : 'DONE_LATE';
  } else if (input.today > dueDate) {
    status = 'OVERDUE';
  } else if (remaining <= (input.dueSoonDays ?? 1)) {
    status = 'DUE_SOON';
  } else {
    status = 'ON_TRACK';
  }
  return { dueDate, elapsedBusinessDays: elapsed, remainingBusinessDays: remaining, status };
}
