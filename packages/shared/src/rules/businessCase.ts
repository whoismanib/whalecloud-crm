import { D, type Numeric, type RuleFailure } from './common';
import type { Settings } from '../schemas/settings';

/** Business case mandatory when amount > USD 2M or net-income margin < 60 % (P4-01). */
export function isBusinessCaseRequired(
  amountUsd: Numeric | null,
  netMargin: Numeric | null,
  settings: Pick<Settings, 'businessCase.amountThresholdUsd' | 'businessCase.marginThreshold'>,
): boolean {
  if (amountUsd !== null && D(amountUsd).gt(settings['businessCase.amountThresholdUsd']))
    return true;
  if (netMargin !== null && D(netMargin).lt(settings['businessCase.marginThreshold'])) return true;
  return false;
}

export interface BusinessCaseDraft {
  pain?: string | null;
  baselineMetric?: string | null;
  benefit?: string | null;
  tcoHorizonYears?: number | null;
  tco?: Numeric | null;
  risks?: string | null;
}

/** One-page case must have pain, baseline, benefit, TCO 3–5 years and risks to be submitted (P4-02). */
export function validateBusinessCaseSubmission(bc: BusinessCaseDraft): RuleFailure[] {
  const f: RuleFailure[] = [];
  for (const field of ['pain', 'baselineMetric', 'benefit', 'risks'] as const) {
    if (!bc[field]?.toString().trim()) f.push({ code: 'FIELD_REQUIRED', params: { field } });
  }
  if (bc.tcoHorizonYears == null || bc.tcoHorizonYears < 3 || bc.tcoHorizonYears > 5) {
    f.push({ code: 'TCO_HORIZON_REQUIRED' });
  }
  if (bc.tco == null || D(bc.tco).lte(0))
    f.push({ code: 'FIELD_REQUIRED', params: { field: 'tco' } });
  return f;
}
