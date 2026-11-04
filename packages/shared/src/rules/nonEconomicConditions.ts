import { D, type Numeric } from './common';
import type { NonEconomicCondition } from '../enums';
import type { Settings } from '../schemas/settings';

export interface TcTerms {
  paymentTermDays?: number | null;
  clpWithoutFxPremium?: boolean | null;
  penaltyCapPct?: Numeric | null;
  unlimitedLiability?: boolean | null;
}

/**
 * Non-economic conditions that need approval even with margins on target (P6-03):
 * payment term > 60 days, CLP price without FX premium, penalties > 10 %, unlimited liability.
 */
export function detectConditions(
  tc: TcTerms,
  settings: Pick<Settings, 'approval.nonEconomic'>,
): NonEconomicCondition[] {
  const cfg = settings['approval.nonEconomic'];
  const out: NonEconomicCondition[] = [];
  if (tc.paymentTermDays != null && tc.paymentTermDays > cfg.paymentTermDays) {
    out.push('PAYMENT_TERM_OVER_60');
  }
  if (tc.clpWithoutFxPremium) out.push('CLP_WITHOUT_FX_PREMIUM');
  if (tc.penaltyCapPct != null && D(tc.penaltyCapPct).gt(cfg.penaltyPct)) {
    out.push('PENALTY_OVER_10');
  }
  if (tc.unlimitedLiability) out.push('UNLIMITED_LIABILITY');
  return out;
}
