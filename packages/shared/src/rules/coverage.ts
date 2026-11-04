import { D, Decimal, money, type Numeric } from './common';

export interface PipelineOpp {
  stage: number;
  status: string;
  amount: Numeric;
  expectedCloseDate: string;
}

/** Stage probability (Lead/0 and stages ≥ 7 do not weight). */
export function stageProbability(stage: number, probs: Record<string, number>): number {
  return probs[String(stage)] ?? 0;
}

/** Σ amount × prob(stage) of open opps in stages 1–6 closing on or before `cutoff` (KPI 7). */
export function weightedPipeline(
  opps: ReadonlyArray<PipelineOpp>,
  probs: Record<string, number>,
  cutoff: string,
): string {
  let total = new Decimal(0);
  for (const o of opps) {
    if (o.status !== 'OPEN' || o.stage < 1 || o.stage > 6) continue;
    if (o.expectedCloseDate > cutoff) continue;
    total = total.plus(D(o.amount).times(stageProbability(o.stage, probs)));
  }
  return money(total);
}

/** Unweighted Σ amount of qualified (stages 1–6) open opps closing on or before cutoff. */
export function unweightedQualifiedPipeline(
  opps: ReadonlyArray<PipelineOpp>,
  cutoff: string,
): string {
  let total = new Decimal(0);
  for (const o of opps) {
    if (o.status !== 'OPEN' || o.stage < 1 || o.stage > 6 || o.expectedCloseDate > cutoff) continue;
    total = total.plus(D(o.amount));
  }
  return money(total);
}

/**
 * Coverage = pipeline / (target − signed). Returns null when there is no target, and
 * `reached: true` when the target is already met (remaining ≤ 0).
 */
export function pipelineCoverage(input: {
  pipeline: Numeric;
  target: Numeric | null;
  signedYtd: Numeric;
}): { ratio: string | null; remaining: string | null; reached: boolean } {
  if (input.target === null) return { ratio: null, remaining: null, reached: false };
  const remaining = D(input.target).minus(D(input.signedYtd));
  if (remaining.lte(0)) return { ratio: null, remaining: money(0), reached: true };
  return {
    ratio: D(input.pipeline).div(remaining).toDecimalPlaces(2).toFixed(2),
    remaining: money(remaining),
    reached: false,
  };
}
