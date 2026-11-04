import type { RuleFailure } from './common';
import type { BillingEngine, ComplianceSection, LineItemType, YesNoNa } from '../enums';

// ---------- P13 distributors ----------

export interface Agreement {
  status: string;
  startsOn: string | null;
  endsOn: string | null;
  territories: readonly string[];
  verticals: readonly string[];
}

/** Agreement in force today for the territory/vertical (P13-01). */
export function agreementFailures(
  agreements: ReadonlyArray<Agreement>,
  opts: { today: string; country: string; vertical?: string | null },
): RuleFailure[] {
  if (!agreements.length) return [{ code: 'DISTRIBUTOR_AGREEMENT_MISSING' }];
  const inForce = agreements.filter(
    (a) =>
      a.status === 'ACTIVE' &&
      (!a.startsOn || a.startsOn <= opts.today) &&
      (!a.endsOn || a.endsOn >= opts.today),
  );
  if (!inForce.length) return [{ code: 'DISTRIBUTOR_AGREEMENT_EXPIRED' }];
  const fits = inForce.some(
    (a) =>
      (a.territories.length === 0 || a.territories.includes(opts.country)) &&
      (!opts.vertical || a.verticals.length === 0 || a.verticals.includes(opts.vertical)),
  );
  return fits ? [] : [{ code: 'DISTRIBUTOR_OUT_OF_TERRITORY', params: { country: opts.country } }];
}

/**
 * P13-02: channel conflict when the account already has an open opportunity that is direct
 * or belongs to another distributor (or a non-rejected registration of another distributor).
 */
export function detectChannelConflict(
  registration: { distributorId: string; accountId: string },
  openOpportunities: ReadonlyArray<{
    id: string;
    accountId: string;
    distributorId: string | null;
    status: string;
  }>,
  otherRegistrations: ReadonlyArray<{
    id: string;
    accountId: string;
    distributorId: string;
    status: string;
  }> = [],
): { conflict: boolean; opportunityIds: string[]; registrationIds: string[] } {
  const opps = openOpportunities.filter(
    (o) =>
      o.accountId === registration.accountId &&
      o.status === 'OPEN' &&
      o.distributorId !== registration.distributorId,
  );
  const regs = otherRegistrations.filter(
    (r) =>
      r.accountId === registration.accountId &&
      r.distributorId !== registration.distributorId &&
      ['SUBMITTED', 'CONFLICT_REVIEW', 'APPROVED'].includes(r.status),
  );
  return {
    conflict: opps.length > 0 || regs.length > 0,
    opportunityIds: opps.map((o) => o.id),
    registrationIds: regs.map((r) => r.id),
  };
}

// ---------- P14 compliance ----------

/** Checklist catalogue (P14-01). `required` items must be answered; export items only if section applies. */
export const COMPLIANCE_ITEMS: { section: ComplianceSection; code: string }[] = [
  { section: 'DATA_PROTECTION', code: 'DP_PERSONAL_DATA_PROCESSED' },
  { section: 'DATA_PROTECTION', code: 'DP_DPA_SIGNED' },
  { section: 'DATA_PROTECTION', code: 'DP_INTERNATIONAL_TRANSFER' },
  { section: 'DATA_PROTECTION', code: 'DP_SECURITY_MEASURES' },
  { section: 'ANTI_CORRUPTION', code: 'AC_PUBLIC_OFFICIALS' },
  { section: 'ANTI_CORRUPTION', code: 'AC_GIFTS_HOSPITALITY' },
  { section: 'ANTI_CORRUPTION', code: 'AC_INTERMEDIARIES' },
  { section: 'PUBLIC_TENDER', code: 'PT_PUBLIC_ENTITY' },
  { section: 'PUBLIC_TENDER', code: 'PT_BASES_REVIEWED' },
  { section: 'PUBLIC_TENDER', code: 'PT_GUARANTEE_REQUIRED' },
  { section: 'EXPORT_CONTROL', code: 'EC_DUAL_USE_HW' },
  { section: 'EXPORT_CONTROL', code: 'EC_LICENSE_REQUIRED' },
  { section: 'EXPORT_CONTROL', code: 'EC_END_USER_DECLARATION' },
];

/** P14-01: export control is mandatory for engine E or hardware lines; the other three always. */
export function requiredComplianceSections(
  engine: BillingEngine,
  lineItemTypes: readonly LineItemType[],
): ComplianceSection[] {
  const base: ComplianceSection[] = ['DATA_PROTECTION', 'ANTI_CORRUPTION', 'PUBLIC_TENDER'];
  if (engine === 'E' || lineItemTypes.includes('HARDWARE')) base.push('EXPORT_CONTROL');
  return base;
}

/** All items of the required sections must be answered before submitting to Legal. */
export function complianceFailures(
  items: ReadonlyArray<{ section: ComplianceSection; itemCode: string; answer: YesNoNa | null }>,
  required: readonly ComplianceSection[],
): RuleFailure[] {
  const missing = items
    .filter((i) => required.includes(i.section) && !i.answer)
    .map((i) => i.itemCode);
  return missing.length
    ? [{ code: 'COMPLIANCE_ITEMS_UNANSWERED', params: { items: missing } }]
    : [];
}
