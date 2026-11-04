import { addDays, businessDaysBetween, type BusinessCalendar } from './businessDays';
import { isBusinessCaseRequired } from './businessCase';
import { result, type Numeric, type RuleFailure, type RuleResult } from './common';
import { compareCashflowVsTc, type PctMilestone } from './milestones';
import { parseRepositoryName } from './naming';
import {
  bantComplete,
  bantMissing,
  meddpiccRequired,
  meddpiccScore,
  type Qualification,
} from './qualification';
import { MAX_STAGE } from '../constants/stages';
import type { ApprovalStatus, NonEconomicCondition, OpportunityStatus, UserRole } from '../enums';
import type { Settings } from '../schemas/settings';

export type GateSettings = Pick<
  Settings,
  | 'qualification.meddpiccThresholdUsd'
  | 'qualification.meddpiccMinScore'
  | 'businessCase.amountThresholdUsd'
  | 'businessCase.marginThreshold'
  | 'compliance.requiredBeforeProposal'
>;

export interface GateContext {
  amountUsd: Numeric | null;
  pain: string | null;
  sponsorContactId: string | null;
  decisionCriteria: string | null;
  decisionDate: string | null;
  qualification: Qualification;
  /** Any contact linked to the opportunity (or account) with role ECONOMIC_BUYER. */
  hasEconomicBuyer: boolean;
  /** Current price request already SUBMITTED (or later). */
  priceRequestSubmitted: boolean;
  approval: {
    status: ApprovalStatus;
    expiresOn: string | null;
    netMargin: Numeric | null;
  } | null;
  /** Net-income margin of the current sheet version (when no approval yet). */
  currentNetMargin: Numeric | null;
  businessCaseApproved: boolean;
  /** Conditions detected on the current sheet T&C that no approved step covers. */
  pendingConditions: NonEconomicCondition[];
  complianceApproved: boolean;
  cashflowMilestones: PctMilestone[];
  tcMilestones: PctMilestone[];
  offerValidityDays: number | null;
  signedContract: { repositoryUrl: string | null; standardName: string | null } | null;
  chinaSystemContractId: string | null;
  handoff: {
    attendeeRoles: UserRole[];
    zmpProjectId: string | null;
    /** Checklist items not reviewed in the meeting (P9-01). */
    checklistMissing?: string[];
  } | null;
  zmpProjectId: string | null;
}

function blank(v: string | null | undefined): boolean {
  return v === null || v === undefined || v.trim() === '';
}

function approvalFailures(ctx: GateContext, today: string): RuleFailure[] {
  const a = ctx.approval;
  if (!a || a.status === 'INVALIDATED' || a.status === 'CANCELLED' || a.status === 'REJECTED') {
    return [{ code: 'APPROVAL_MISSING', params: { status: a?.status ?? null } }];
  }
  if (a.status === 'EXPIRED' || (a.status === 'APPROVED' && a.expiresOn && today > a.expiresOn)) {
    return [{ code: 'APPROVAL_EXPIRED', params: { expiresOn: a.expiresOn } }];
  }
  if (a.status !== 'APPROVED') return [{ code: 'APPROVAL_MISSING', params: { status: a.status } }];
  return [];
}

/** Single-step gate from → from+1 (ARCHITECTURE §8.1). */
export function gateFor(
  from: number,
  ctx: GateContext,
  settings: GateSettings,
  today: string,
): RuleFailure[] {
  const f: RuleFailure[] = [];
  const meddpicc = () => {
    if (!meddpiccRequired(ctx.amountUsd, settings)) return;
    const score = meddpiccScore(ctx.qualification);
    if (score < settings['qualification.meddpiccMinScore']) {
      f.push({ code: 'MEDDPICC_BELOW_50', params: { score } });
    }
  };
  switch (from) {
    case 0: // Lead → Calificada (P2-01)
      if (blank(ctx.pain)) f.push({ code: 'PAIN_MISSING' });
      if (blank(ctx.sponsorContactId)) f.push({ code: 'SPONSOR_MISSING' });
      if (!bantComplete(ctx.qualification)) {
        f.push({ code: 'BANT_INCOMPLETE', params: { missing: bantMissing(ctx.qualification) } });
      }
      break;
    case 1: // → Descubrimiento (P2-02)
      if (!bantComplete(ctx.qualification)) {
        f.push({ code: 'BANT_INCOMPLETE', params: { missing: bantMissing(ctx.qualification) } });
      }
      meddpicc();
      break;
    case 2: // → Solución (P2-04, P2-06)
      if (blank(ctx.decisionCriteria)) f.push({ code: 'DECISION_CRITERIA_MISSING' });
      meddpicc();
      break;
    case 3: // → Precio solicitado (P2-03, P5-03)
      if (!ctx.hasEconomicBuyer) f.push({ code: 'ECONOMIC_BUYER_MISSING' });
      if (blank(ctx.decisionDate)) f.push({ code: 'DECISION_DATE_MISSING' });
      if (!ctx.priceRequestSubmitted) f.push({ code: 'PRICE_REQUEST_NOT_SUBMITTED' });
      break;
    case 4: {
      // → Propuesta enviada (P7-03)
      f.push(...approvalFailures(ctx, today));
      const margin = ctx.approval?.netMargin ?? ctx.currentNetMargin;
      if (isBusinessCaseRequired(ctx.amountUsd, margin, settings) && !ctx.businessCaseApproved) {
        f.push({ code: 'BUSINESS_CASE_REQUIRED' });
      }
      if (ctx.pendingConditions.length) {
        f.push({ code: 'NON_ECONOMIC_PENDING', params: { conditions: ctx.pendingConditions } });
      }
      if (settings['compliance.requiredBeforeProposal'] && !ctx.complianceApproved) {
        f.push({ code: 'COMPLIANCE_PENDING' });
      }
      const cmp = compareCashflowVsTc(ctx.cashflowMilestones, ctx.tcMilestones);
      if (!ctx.cashflowMilestones.length || !ctx.tcMilestones.length) {
        f.push({ code: 'MILESTONES_MISSING' });
      } else if (!cmp.equal) {
        f.push({
          code: 'CASHFLOW_TC_MISMATCH',
          params: {
            cashflow: ctx.cashflowMilestones.map((m) => String(m.pct)).join('/'),
            tc: ctx.tcMilestones.map((m) => String(m.pct)).join('/'),
          },
        });
      }
      const exp = ctx.approval?.expiresOn;
      if (exp && ctx.offerValidityDays != null) {
        const offerValidUntil = addDays(today, ctx.offerValidityDays);
        if (offerValidUntil > exp) {
          f.push({
            code: 'OFFER_VALIDITY_EXCEEDS_APPROVAL',
            params: { offerValidUntil, approvalExpiresOn: exp },
          });
        }
      }
      break;
    }
    case 5: // → Negociación: approval must still be valid
      f.push(...approvalFailures(ctx, today));
      break;
    case 6: {
      // → Ganada (P7-05)
      const c = ctx.signedContract;
      if (!c || blank(c.repositoryUrl) || !c.standardName || !parseRepositoryName(c.standardName)) {
        f.push({ code: 'SIGNED_CONTRACT_MISSING' });
      }
      if (blank(ctx.chinaSystemContractId)) f.push({ code: 'CHINA_SYSTEM_ID_MISSING' });
      break;
    }
    case 7: {
      // → En entrega (P9-02)
      const h = ctx.handoff;
      if (
        !h ||
        !h.attendeeRoles.includes('LOCAL_DELIVERY') ||
        !h.attendeeRoles.includes('CHINA_DELIVERY')
      ) {
        f.push({ code: 'HANDOFF_MISSING' });
      }
      if (h?.checklistMissing?.length) {
        f.push({ code: 'HANDOFF_CHECKLIST_INCOMPLETE', params: { missing: h.checklistMissing } });
      }
      if (blank(ctx.zmpProjectId) && blank(h?.zmpProjectId ?? null))
        f.push({ code: 'ZMP_ID_MISSING' });
      break;
    }
    default:
      f.push({ code: 'STAGE_DERIVED' });
  }
  return f;
}

/**
 * Evaluates a stage transition. Jumps evaluate every intermediate gate; going backwards needs
 * a reason; stages 9–11 are derived from milestones and cannot be set manually.
 */
export function evaluateStageGate(
  ctx: GateContext,
  from: number,
  to: number,
  settings: GateSettings,
  today: string,
  opts: { reason?: string | null; status?: OpportunityStatus } = {},
): RuleResult {
  if (!Number.isInteger(to) || to < 0 || to > MAX_STAGE) {
    return result([{ code: 'STAGE_INVALID', params: { to } }]);
  }
  if (opts.status && opts.status !== 'OPEN') {
    return result([{ code: 'OPPORTUNITY_CLOSED', params: { status: opts.status } }]);
  }
  if (to === from) return result([{ code: 'SAME_STAGE' }]);
  if (to >= 9 || from >= 9) return result([{ code: 'STAGE_DERIVED' }]);
  if (to < from) {
    return result(blank(opts.reason ?? null) ? [{ code: 'BACKWARD_REASON_REQUIRED' }] : []);
  }
  const failures: RuleFailure[] = [];
  const seen = new Set<string>();
  for (let s = from; s < to; s++) {
    for (const fail of gateFor(s, ctx, settings, today)) {
      if (seen.has(fail.code)) continue;
      seen.add(fail.code);
      failures.push({ ...fail, params: { ...fail.params, fromStage: s, toStage: s + 1 } });
    }
  }
  return result(failures);
}

export interface OpportunityCreateInput {
  accountId?: string | null;
  contactId?: string | null;
  vertical?: string | null;
  countryCode?: string | null;
  origin?: string | null;
  billingEngine?: string | null;
  distributorId?: string | null;
}

/** Creation gate (→0, P1-01, CORE-02). */
export function validateOpportunityCreate(input: OpportunityCreateInput): RuleResult {
  const f: RuleFailure[] = [];
  for (const field of ['accountId', 'contactId', 'vertical', 'countryCode', 'origin'] as const) {
    if (blank(input[field] ?? null)) f.push({ code: 'FIELD_REQUIRED', params: { field } });
  }
  if (blank(input.billingEngine ?? null)) f.push({ code: 'ENGINE_REQUIRED' });
  if (input.origin === 'DISTRIBUTOR' && blank(input.distributorId ?? null)) {
    f.push({ code: 'DISTRIBUTOR_REQUIRED' });
  }
  return result(f);
}

/** P1-02: registered later than N business days after first contact → late. */
export function isRegisteredLate(
  firstContactDate: string,
  registeredOn: string,
  cal: BusinessCalendar,
  slaBusinessDays: number,
): boolean {
  return businessDaysBetween(firstContactDate, registeredOn, cal) > slaBusinessDays;
}

/** CORE-10: closing as LOST/DISCARDED/NOT_QUOTED needs a reason; LOST needs the winner. */
export function validateClose(input: {
  status: OpportunityStatus;
  reason?: string | null;
  winningCompetitor?: string | null;
}): RuleResult {
  const f: RuleFailure[] = [];
  if (input.status === 'OPEN') f.push({ code: 'STATUS_INVALID' });
  if (blank(input.reason ?? null)) f.push({ code: 'CLOSE_REASON_REQUIRED' });
  if (input.status === 'LOST' && blank(input.winningCompetitor ?? null)) {
    f.push({ code: 'WINNING_COMPETITOR_REQUIRED' });
  }
  return result(f);
}
