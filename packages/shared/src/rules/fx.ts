import { monthOf } from './businessDays';
import { D, Decimal, money, type Numeric } from './common';
import type { Currency } from '../enums';

export interface FxRate {
  /** First day of month, YYYY-MM-01. */
  month: string;
  currency: Currency;
  /** Units of currency per 1 USD (USD = 1). */
  unitsPerUsd: Numeric;
}

export interface ResolvedRate {
  rate: Decimal;
  month: string;
  provisional: boolean;
}

/**
 * Rate of the event month; if missing, the latest earlier month is used and flagged
 * provisional (CORE-04). Throws when no rate at all exists for the currency.
 */
export function resolveRate(
  month: string,
  currency: Currency,
  table: ReadonlyArray<FxRate>,
): ResolvedRate {
  const m = monthOf(month);
  if (currency === 'USD') return { rate: new Decimal(1), month: m, provisional: false };
  const candidates = table
    .filter((r) => r.currency === currency && r.month <= m)
    .sort((a, b) => (a.month < b.month ? 1 : -1));
  const best = candidates[0];
  if (!best) {
    // fall back to the earliest future rate (data loaded later than the event)
    const future = table
      .filter((r) => r.currency === currency)
      .sort((a, b) => (a.month < b.month ? -1 : 1))[0];
    if (!future) throw new RangeError(`FX_RATE_MISSING:${currency}`);
    return { rate: D(future.unitsPerUsd), month: future.month, provisional: true };
  }
  return { rate: D(best.unitsPerUsd), month: best.month, provisional: best.month !== m };
}

/** USD is the pivot: x(A→B) = x / upu[A] × upu[B]. */
export function convert(
  amount: Numeric,
  from: Currency,
  to: Currency,
  date: string,
  table: ReadonlyArray<FxRate>,
): { amount: string; provisional: boolean } {
  if (from === to) return { amount: money(amount), provisional: false };
  const a = resolveRate(date, from, table);
  const b = resolveRate(date, to, table);
  return {
    amount: money(D(amount).div(a.rate).times(b.rate)),
    provisional: a.provisional || b.provisional,
  };
}

export interface MoneyEquivalents {
  usd: string;
  cny: string;
  clp: string;
  fxMonth: string;
  fxProvisional: boolean;
}

/** Equivalents stored with every business amount (DATA-MODEL §1 +MONEY). CLP has no decimals. */
export function moneyEquivalents(
  amount: Numeric,
  currency: Currency,
  date: string,
  table: ReadonlyArray<FxRate>,
): MoneyEquivalents {
  const usd = convert(amount, currency, 'USD', date, table);
  const cny = convert(amount, currency, 'CNY', date, table);
  const clp = convert(amount, currency, 'CLP', date, table);
  return {
    usd: usd.amount,
    cny: cny.amount,
    clp: D(clp.amount).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toFixed(0),
    fxMonth: monthOf(date),
    fxProvisional: usd.provisional || cny.provisional || clp.provisional,
  };
}
