import { describe, expect, it } from 'vitest';
import {
  addBusinessDays,
  addDays,
  assertIsoDate,
  businessDaysBetween,
  daysBetween,
  hoursToBusinessDays,
  isBusinessDay,
  monthOf,
  subtractBusinessDays,
} from './businessDays';
import { computeSla } from './slaClock';
import { CL_CALENDAR, CN_CALENDAR, toBusinessCalendar } from '../constants/holidays';

const CL = toBusinessCalendar(CL_CALENDAR);
const CN = toBusinessCalendar(CN_CALENDAR);

describe('business days (Chile/China calendars)', () => {
  it('internal deadline: client close 2026-12-01 − 5 business days = 2026-11-24 (P3-02)', () => {
    expect(subtractBusinessDays('2026-12-01', 5, CL)).toBe('2026-11-24');
  });

  it('skips weekends and Chilean holidays', () => {
    expect(isBusinessDay('2026-09-18', CL)).toBe(false); // Fiestas Patrias
    expect(isBusinessDay('2026-11-07', CL)).toBe(false); // Saturday
    expect(isBusinessDay('2026-11-04', CL)).toBe(true);
    // Thu 2026-09-17 + 1 business day → Mon 2026-09-21 (18 holiday, 19-20 weekend)
    expect(addBusinessDays('2026-09-17', 1, CL)).toBe('2026-09-21');
    expect(addBusinessDays('2026-11-04', 0, CL)).toBe('2026-11-04');
  });

  it('China calendar: Golden Week and make-up Saturday', () => {
    expect(isBusinessDay('2026-10-05', CN)).toBe(false);
    expect(isBusinessDay('2026-10-10', CN)).toBe(true); // 调休 Saturday
    expect(addBusinessDays('2026-09-30', 1, CN)).toBe('2026-10-08');
    // P5 SLA from 2026-09-24 (Thu): Mid-Autumn 25–27 + Golden Week 1–7
    expect(addBusinessDays('2026-09-24', 10, CN)).toBe('2026-10-15');
  });

  it('counts business days between dates (exclusive start, inclusive end)', () => {
    expect(businessDaysBetween('2026-11-02', '2026-11-09', CL)).toBe(5);
    expect(businessDaysBetween('2026-11-09', '2026-11-02', CL)).toBe(-5);
    expect(businessDaysBetween('2026-11-02', '2026-11-02', CL)).toBe(0);
    expect(daysBetween('2026-11-30', '2026-12-15')).toBe(15);
    expect(addDays('2026-11-30', -10)).toBe('2026-11-20');
  });

  it('converts hours to business days and validates input', () => {
    expect(hoursToBusinessDays(48)).toBe(2);
    expect(hoursToBusinessDays(49)).toBe(3);
    expect(() => hoursToBusinessDays(-1)).toThrow();
    expect(() => assertIsoDate('2026-13-45')).toThrow();
    expect(() => addBusinessDays('2026-11-04', 1.5, CL)).toThrow();
    expect(monthOf('2026-11-24')).toBe('2026-11-01');
  });

  it('accepts plain arrays as holiday lists', () => {
    expect(isBusinessDay('2026-11-04', { weekend: [0, 6], holidays: ['2026-11-04'] })).toBe(false);
    expect(
      isBusinessDay('2026-11-07', { weekend: [0, 6], holidays: [], extraWorkdays: ['2026-11-07'] }),
    ).toBe(true);
  });
});

describe('SLA clock', () => {
  it('P5 project SLA: 10 business days, overdue after due date (P5-03)', () => {
    const s = computeSla({ start: '2026-11-04', days: 10, calendar: CL, today: '2026-11-19' });
    expect(s.dueDate).toBe('2026-11-18');
    expect(s.status).toBe('OVERDUE');
    expect(s.elapsedBusinessDays).toBe(11);
  });
  it('due soon one business day before; pauses extend the due date (P5-08)', () => {
    expect(
      computeSla({ start: '2026-11-04', days: 10, calendar: CL, today: '2026-11-17' }).status,
    ).toBe('DUE_SOON');
    expect(
      computeSla({ start: '2026-11-04', days: 10, calendar: CL, today: '2026-11-05' }).status,
    ).toBe('ON_TRACK');
    const paused = computeSla({
      start: '2026-11-04',
      days: 10,
      calendar: CL,
      today: '2026-11-19',
      pausedBusinessDays: 2,
    });
    expect(paused.dueDate).toBe('2026-11-20');
    expect(paused.status).toBe('DUE_SOON');
  });
  it('done on time vs late', () => {
    expect(
      computeSla({
        start: '2026-11-04',
        days: 3,
        calendar: CL,
        today: '2026-11-30',
        doneOn: '2026-11-06',
      }).status,
    ).toBe('DONE');
    expect(
      computeSla({
        start: '2026-11-04',
        days: 3,
        calendar: CL,
        today: '2026-11-30',
        doneOn: '2026-11-20',
      }).status,
    ).toBe('DONE_LATE');
  });
});
