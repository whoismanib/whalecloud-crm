import type { ProblemError } from '../../api/client';

export interface Contact {
  id: string;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  buyingRoles: string[];
  roles: string[];
}

export interface OppDetail {
  id: string;
  code: string;
  name: string;
  accountId: string;
  ownerId: string;
  ownerName: string | null;
  countryCode: string;
  vertical: string;
  billingEngine: string;
  origin: string;
  stage: number;
  status: string;
  amount: string;
  amountCurrency: string;
  amountUsd: string;
  amountCny: string;
  amountFxMonth: string;
  amountFxProvisional: boolean;
  expectedCloseDate: string;
  decisionDate: string | null;
  firstContactDate: string;
  registeredLate: boolean;
  forecastCategory: string | null;
  risk: string | null;
  pain: string | null;
  sponsorContactId: string | null;
  decisionCriteria: string | null;
  competitors: string[];
  customerTypeFrozen: string | null;
  countsAsDigital: boolean;
  currentPriceRequestId: string | null;
  currentSheetVersionId: string | null;
  chinaSheetVersionLabel: string | null;
  currentApprovalRequestId: string | null;
  approvedNetMargin: string | null;
  approvedContractMargin: string | null;
  approvalExpiresOn: string | null;
  chinaSystemContractId: string | null;
  zmpProjectId: string | null;
  closeReason: string | null;
  winningCompetitor: string | null;
  rowVersion: number;
  account: {
    id: string;
    name: string;
    customerType: string;
    acceptsSimpleEsign: boolean;
    countryCode: string;
  };
  qualification: Record<string, string> & { meddpiccScore: number };
  contacts: Contact[];
  stageHistory: {
    id: number;
    fromStage: number | null;
    toStage: number;
    toStatus: string;
    changedAt: string;
    reason: string | null;
    derived: boolean;
  }[];
  approval: { id: string; status: string; band: string; expiresOn: string | null } | null;
  handoff: {
    zmpProjectId: string | null;
    attendeeUserIds: string[];
    meetingAt: string | null;
    dueOn?: string | null;
    acceptanceCriteria?: string | null;
    commercialSheetReviewed?: boolean;
    sowReviewed?: boolean;
    milestonesReviewed?: boolean;
    acceptanceCriteriaReviewed?: boolean;
  } | null;
  businessCases: {
    id: string;
    version: number;
    status: string;
    pain: string | null;
    tcoHorizonYears: number | null;
  }[];
  nextGate: { toStage: number; ok: boolean; failures: ProblemError[] } | null;
  health: {
    score: number | null;
    status: string;
    reasons: { code: string; params?: Record<string, unknown> }[];
  };
}

export interface TabProps {
  opp: OppDetail;
}
