import { D, type Numeric, type RuleFailure } from './common';
import { milestonesFailures } from './milestones';

/** A1 fields (source "Qué hace cada pestaña" A1, P5-01). */
export const A1_FIELDS = [
  'countryCode',
  'accountId',
  'relationshipType',
  'competitionType',
  'salesOwnerId',
  'solutionOwnerName',
  'deliveryOwnerName',
  'projectStageLabel',
  'projectLevel',
  'budget',
  'signingModel',
  'currency',
  'warrantyMonths',
  'summary',
  'strategy',
  'mainCompetitor',
  'risks',
] as const;

export type A1Field = (typeof A1_FIELDS)[number];

export interface PriceRequestDraft extends Partial<Record<A1Field, unknown>> {
  scopeSummary?: string | null;
  billingEngine?: string | null;
  targetPrice?: Numeric | null;
  targetCompetitor?: string | null;
  expectedMilestones: ReadonlyArray<{ pct: Numeric }>;
}

function empty(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

/** A1 complete + the four extra data (scope, engine, expected milestones = 100 %, target price) (P5-01/02). */
export function validatePriceRequest(pr: PriceRequestDraft): RuleFailure[] {
  const failures: RuleFailure[] = [];
  const missingA1 = A1_FIELDS.filter((f) => empty(pr[f]));
  if (missingA1.length) failures.push({ code: 'A1_INCOMPLETE', params: { fields: missingA1 } });
  if (empty(pr.scopeSummary)) failures.push({ code: 'SCOPE_REQUIRED' });
  if (empty(pr.billingEngine)) failures.push({ code: 'ENGINE_REQUIRED' });
  if (empty(pr.targetPrice) || D(pr.targetPrice as Numeric).lte(0) || empty(pr.targetCompetitor)) {
    failures.push({ code: 'TARGET_PRICE_REQUIRED' });
  }
  failures.push(...milestonesFailures(pr.expectedMilestones));
  return failures;
}
