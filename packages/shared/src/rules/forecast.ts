import { addDays, daysBetween } from './businessDays';
import { D, Decimal, money, type Numeric } from './common';
import type { ForecastCategory } from '../enums';

/** ISO week (year, week) of a date. */
export function isoWeek(date: string): { year: number; week: number } {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

/** P12-02 weekly cadence: Monday update, Tuesday review with CM, Wednesday report. */
export function cadenceStep(date: string): 'UPDATE' | 'REVIEW' | 'REPORT' | 'NONE' {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  return dow === 1 ? 'UPDATE' : dow === 2 ? 'REVIEW' : dow === 3 ? 'REPORT' : 'NONE';
}

/** Last Friday strictly before `date` (P12-02 "sin actualizar desde el viernes anterior"). */
export function previousFriday(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  const back = (dow + 7 - 5) % 7 || 7;
  return addDays(date, -back);
}

/** P12-01: COMMIT only from stage ⚙ 4; open stages 1–7 need a category. */
export function categoryWarnings(
  stage: number,
  category: ForecastCategory | null,
  commitMinStage: number,
): string[] {
  if (stage >= 1 && stage <= 7 && !category) return ['CATEGORY_REQUIRED'];
  if (category === 'COMMIT' && stage < commitMinStage) return ['CATEGORY_INCONSISTENT'];
  return [];
}

export interface ForecastItem {
  opportunityId: string;
  stage: number;
  status: string;
  forecastCategory: ForecastCategory | null;
  amount: Numeric;
  expectedCloseDate: string;
  probability?: number;
}

/** Totals per category + weighted, for open opportunities closing in [from, to]. */
export function forecastTotals(
  items: ReadonlyArray<ForecastItem>,
  probs: Record<string, number>,
  from: string,
  to: string,
) {
  const t = {
    COMMIT: new Decimal(0),
    PROBABLE: new Decimal(0),
    PIPELINE: new Decimal(0),
    weighted: new Decimal(0),
  };
  for (const i of items) {
    if (
      i.status !== 'OPEN' ||
      i.stage > 7 ||
      i.expectedCloseDate < from ||
      i.expectedCloseDate > to
    )
      continue;
    if (i.forecastCategory) t[i.forecastCategory] = t[i.forecastCategory].plus(D(i.amount));
    t.weighted = t.weighted.plus(
      D(i.amount).times(i.stage >= 7 ? 1 : (probs[String(i.stage)] ?? 0)),
    );
  }
  return {
    commit: money(t.COMMIT),
    probable: money(t.PROBABLE),
    pipeline: money(t.PIPELINE),
    weighted: money(t.weighted),
    commitPlusProbable: money(t.COMMIT.plus(t.PROBABLE)),
  };
}

/** P12-05: (actual − forecast) / forecast, within ± tolerance. */
export function forecastAccuracy(
  actual: Numeric,
  forecast: Numeric,
  tolerance = 0.1,
): { deviation: number | null; withinTolerance: boolean | null } {
  const f = D(forecast);
  if (f.isZero()) return { deviation: null, withinTolerance: null };
  const dev = D(actual).minus(f).div(f).toDecimalPlaces(4).toNumber();
  return { deviation: dev, withinTolerance: Math.abs(dev) <= tolerance };
}

export type WeekChange = 'NEW' | 'ADVANCED' | 'REGRESSED' | 'SLIPPED' | 'WON' | 'LOST' | 'REMOVED';

/** P12-06: week-over-week changes between two snapshots. */
export function weekOverWeekChanges(
  prev: ReadonlyArray<ForecastItem>,
  curr: ReadonlyArray<ForecastItem>,
): { opportunityId: string; change: WeekChange; from?: number | string; to?: number | string }[] {
  const p = new Map(prev.map((i) => [i.opportunityId, i]));
  const out: {
    opportunityId: string;
    change: WeekChange;
    from?: number | string;
    to?: number | string;
  }[] = [];
  for (const c of curr) {
    const o = p.get(c.opportunityId);
    if (!o) {
      out.push({ opportunityId: c.opportunityId, change: 'NEW', to: c.stage });
      continue;
    }
    if (o.status === 'OPEN' && c.status !== 'OPEN')
      out.push({ opportunityId: c.opportunityId, change: 'LOST', to: c.status });
    else if (o.stage < 7 && c.stage >= 7)
      out.push({ opportunityId: c.opportunityId, change: 'WON', from: o.stage, to: c.stage });
    else if (c.stage > o.stage)
      out.push({ opportunityId: c.opportunityId, change: 'ADVANCED', from: o.stage, to: c.stage });
    else if (c.stage < o.stage)
      out.push({ opportunityId: c.opportunityId, change: 'REGRESSED', from: o.stage, to: c.stage });
    if (
      c.expectedCloseDate > o.expectedCloseDate &&
      daysBetween(o.expectedCloseDate, c.expectedCloseDate) > 0
    ) {
      out.push({
        opportunityId: c.opportunityId,
        change: 'SLIPPED',
        from: o.expectedCloseDate,
        to: c.expectedCloseDate,
      });
    }
  }
  const curIds = new Set(curr.map((c) => c.opportunityId));
  for (const o of prev)
    if (!curIds.has(o.opportunityId))
      out.push({ opportunityId: o.opportunityId, change: 'REMOVED' });
  return out;
}

/** Calendar quarter of "2026Q4" → [from, to]. */
export function quarterRange(period: string): { from: string; to: string } {
  const m = /^(\d{4})Q([1-4])$/.exec(period);
  if (!m) throw new RangeError(`Invalid period ${period}`);
  const y = m[1]!;
  const q = Number(m[2]);
  const startMonth = (q - 1) * 3 + 1;
  const from = `${y}-${String(startMonth).padStart(2, '0')}-01`;
  const endMonth = startMonth + 2;
  const lastDay = new Date(Date.UTC(Number(y), endMonth, 0)).getUTCDate();
  return { from, to: `${y}-${String(endMonth).padStart(2, '0')}-${lastDay}` };
}
