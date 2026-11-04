import { moneyEquivalents, type Currency, type FxRate } from '@wcrm/shared';
import { AppError } from '../lib/errors';

/**
 * Column values for a +MONEY(prefix) group: original amount/currency + USD/CNY/CLP equivalents
 * with the FX month used (DATA-MODEL §1, CORE-02/04).
 */
export function moneyColumns<P extends string>(
  prefix: P,
  amount: string | null | undefined,
  currency: Currency | null | undefined,
  date: string,
  fx: FxRate[],
): Record<string, string | boolean | null> {
  if (amount === null || amount === undefined || !currency) {
    return {
      [prefix]: amount ?? null,
      [`${prefix}Currency`]: currency ?? null,
      [`${prefix}Usd`]: null,
      [`${prefix}Cny`]: null,
      [`${prefix}Clp`]: null,
      [`${prefix}FxMonth`]: null,
      [`${prefix}FxProvisional`]: false,
    };
  }
  let eq;
  try {
    eq = moneyEquivalents(amount, currency, date, fx);
  } catch {
    throw new AppError(422, 'BUSINESS_RULE_VIOLATION', 'FX_RATE_MISSING', [
      { code: 'FX_RATE_MISSING', params: { currency } },
    ]);
  }
  return {
    [prefix]: amount,
    [`${prefix}Currency`]: currency,
    [`${prefix}Usd`]: eq.usd,
    [`${prefix}Cny`]: eq.cny,
    [`${prefix}Clp`]: eq.clp,
    [`${prefix}FxMonth`]: eq.fxMonth,
    [`${prefix}FxProvisional`]: eq.fxProvisional,
  };
}

/** API money object (API.md §1.1). */
export function moneyOut(row: Record<string, unknown>, prefix: string) {
  if (row[prefix] === null || row[prefix] === undefined) return null;
  return {
    amount: row[prefix],
    currency: row[`${prefix}Currency`],
    usd: row[`${prefix}Usd`],
    cny: row[`${prefix}Cny`],
    clp: row[`${prefix}Clp`],
    fxMonth: row[`${prefix}FxMonth`],
    fxProvisional: row[`${prefix}FxProvisional`],
  };
}
