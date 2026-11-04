import Decimal from 'decimal.js';

export type Numeric = string | number | Decimal;

/** A rule violation, translated on the client via `errors.<code>` with `params`. */
export interface RuleFailure {
  code: string;
  params?: Record<string, string | number | boolean | string[] | null>;
}

export interface RuleResult {
  ok: boolean;
  failures: RuleFailure[];
}

export function result(failures: RuleFailure[]): RuleResult {
  return { ok: failures.length === 0, failures };
}

export function D(v: Numeric | null | undefined): Decimal {
  if (v === null || v === undefined || v === '') return new Decimal(0);
  return new Decimal(v);
}

/** Money string with 2 decimals (half-up). */
export function money(v: Numeric): string {
  return D(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

/** Fraction string with 6 decimals (numeric(7,6)). */
export function fraction(v: Numeric): string {
  return D(v).toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6);
}

export { Decimal };
