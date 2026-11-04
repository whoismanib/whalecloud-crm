import type { LegacyStatus, OpportunityStatus } from '../enums';

/** Legacy tracker status → CRM stage/status (LEGACY-DASHBOARD.md "Mapeo de estados"). */
export function legacyStatusToStage(legacy: LegacyStatus): {
  stage: number | null;
  status: OpportunityStatus;
} {
  switch (legacy) {
    case 'Preparing RFP':
      return { stage: 3, status: 'OPEN' };
    case 'Preparing TP':
      return { stage: 4, status: 'OPEN' };
    case 'RFP Sent':
    case 'TP Sent':
      return { stage: 5, status: 'OPEN' };
    case 'PVB':
      return { stage: 6, status: 'OPEN' };
    case 'Voucher':
    case 'PO':
      return { stage: 7, status: 'OPEN' };
    case 'Cancelled':
      return { stage: null, status: 'LOST' };
  }
}

/** CRM stage → closest legacy label (for exports to the legacy format). */
export function stageToLegacyStatus(stage: number, status: OpportunityStatus): LegacyStatus | null {
  if (status !== 'OPEN') return 'Cancelled';
  if (stage >= 7) return 'PO';
  if (stage === 6) return 'PVB';
  if (stage === 5) return 'TP Sent';
  if (stage === 4) return 'Preparing TP';
  if (stage === 3) return 'Preparing RFP';
  return null;
}

/** Legacy goal bar: "cerrado" = stage ≥ 7, "en curso" = stages 3–6 (open). */
export function legacyGoalBucket(
  stage: number,
  status: OpportunityStatus,
): 'CLOSED' | 'IN_FLIGHT' | 'EARLY' | 'CANCELLED' {
  if (status !== 'OPEN') return 'CANCELLED';
  if (stage >= 7) return 'CLOSED';
  if (stage >= 3) return 'IN_FLIGHT';
  return 'EARLY';
}
