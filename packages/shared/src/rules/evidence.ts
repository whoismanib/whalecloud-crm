import type { RuleFailure } from './common';
import type { BillingEngine, EvidenceType, SignatureType } from '../enums';

/**
 * Evidence required per billing engine before a milestone is accepted / sent to Finance
 * (source "Los cinco motores", P8-02/P8-03).
 * E: physical delivery (sale) or elapsed month (rental).
 */
export function requiredEvidence(
  engine: BillingEngine,
  opts: { rental?: boolean } = {},
): EvidenceType[] {
  switch (engine) {
    case 'A':
      return ['ACCEPTANCE_EMAIL', 'MSA', 'SIGNED_AC', 'RECEPTION'];
    case 'B':
      return ['PO', 'RECEPTION'];
    case 'C':
      return ['TERM_START'];
    case 'D':
      return ['PERIOD_ELAPSED', 'USAGE_REPORT'];
    case 'E':
      return opts.rental ? ['PERIOD_ELAPSED'] : ['DELIVERY_NOTE'];
  }
}

export interface EvidenceItem {
  evidenceType: EvidenceType;
  signatureType?: SignatureType | null;
}

export function missingEvidence(
  engine: BillingEngine,
  evidence: ReadonlyArray<EvidenceItem>,
  opts: { rental?: boolean } = {},
): EvidenceType[] {
  const have = new Set(evidence.map((e) => e.evidenceType));
  return requiredEvidence(engine, opts).filter((t) => !have.has(t));
}

/** Simple e-signature on AC/reception is only allowed when the account accepts it (PRD Q7). */
export function signatureFailures(
  item: EvidenceItem,
  account: { acceptsSimpleEsign: boolean },
): RuleFailure[] {
  const signed: EvidenceType[] = ['SIGNED_AC', 'RECEPTION', 'PO'];
  if (
    signed.includes(item.evidenceType) &&
    item.signatureType === 'SIMPLE_ESIGN' &&
    !account.acceptsSimpleEsign
  ) {
    return [{ code: 'SIMPLE_ESIGN_NOT_ACCEPTED', params: { evidenceType: item.evidenceType } }];
  }
  return [];
}

export function canAccept(
  engine: BillingEngine,
  evidence: ReadonlyArray<EvidenceItem>,
  account: { acceptsSimpleEsign: boolean },
  opts: { rental?: boolean } = {},
): RuleFailure[] {
  const failures: RuleFailure[] = [];
  const missing = missingEvidence(engine, evidence, opts);
  if (missing.length)
    failures.push({ code: 'EVIDENCE_MISSING', params: { types: missing, engine } });
  for (const e of evidence) failures.push(...signatureFailures(e, account));
  return failures;
}

/** Package to China Finance requires an accepted milestone with complete evidence (P8-04). */
export function canSendToFinance(
  milestone: { status: string; billingEngine: BillingEngine },
  evidence: ReadonlyArray<EvidenceItem>,
  account: { acceptsSimpleEsign: boolean },
  opts: { rental?: boolean } = {},
): RuleFailure[] {
  const failures: RuleFailure[] = [];
  if (milestone.status !== 'ACCEPTED') {
    failures.push({ code: 'MILESTONE_NOT_ACCEPTED', params: { status: milestone.status } });
  }
  failures.push(...canAccept(milestone.billingEngine, evidence, account, opts));
  return failures;
}
