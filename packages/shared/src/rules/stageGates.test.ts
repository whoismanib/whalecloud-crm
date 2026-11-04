import { describe, expect, it } from 'vitest';
import {
  evaluateStageGate,
  isRegisteredLate,
  validateClose,
  validateOpportunityCreate,
  type GateContext,
} from './stageGates';
import { EMPTY_QUALIFICATION, type Qualification } from './qualification';
import { CL_CALENDAR, toBusinessCalendar } from '../constants/holidays';
import { DEFAULT_SETTINGS } from '../schemas/settings';

const S = DEFAULT_SETTINGS;
const TODAY = '2026-11-04';
const FULL_BANT: Qualification = {
  ...EMPTY_QUALIFICATION,
  bantBudget: 'COMPLETE',
  bantAuthority: 'COMPLETE',
  bantNeed: 'COMPLETE',
  bantTimeline: 'COMPLETE',
};
const MEDDPICC_HALF: Qualification = {
  ...FULL_BANT,
  mMetrics: 'COMPLETE',
  mEconomicBuyer: 'COMPLETE',
  mDecisionCriteria: 'COMPLETE',
  mDecisionProcess: 'COMPLETE',
};
const ms = (pcts: number[]) =>
  pcts.map((pct, i) => ({ seq: i + 1, pct, trigger: 'OTHER' as const }));

function ctx(over: Partial<GateContext> = {}): GateContext {
  return {
    amountUsd: '300000',
    pain: 'Billing legacy',
    sponsorContactId: 'c1',
    decisionCriteria: 'TCO + time to market',
    decisionDate: '2026-12-15',
    qualification: FULL_BANT,
    hasEconomicBuyer: true,
    priceRequestSubmitted: true,
    approval: { status: 'APPROVED', expiresOn: '2027-01-03', netMargin: '0.70' },
    currentNetMargin: '0.70',
    businessCaseApproved: false,
    pendingConditions: [],
    complianceApproved: false,
    cashflowMilestones: ms([30, 50, 20]),
    tcMilestones: ms([30, 50, 20]),
    offerValidityDays: 30,
    signedContract: {
      repositoryUrl: 'https://repo.example.com/wom',
      standardName: 'CL_WOM_OC_4500123_v1_2026-11-04.pdf',
    },
    chinaSystemContractId: 'CN-2026-001',
    handoff: { attendeeRoles: ['LOCAL_DELIVERY', 'CHINA_DELIVERY'], zmpProjectId: 'ZMP-1' },
    zmpProjectId: 'ZMP-1',
    ...over,
  };
}
const codes = (r: { failures: { code: string }[] }) => r.failures.map((f) => f.code);

describe('stage gates 0–8 (ARCHITECTURE §8.1)', () => {
  it('0→1 needs pain, sponsor and complete BANT (P2-01)', () => {
    const r = evaluateStageGate(
      ctx({ pain: '', sponsorContactId: null, qualification: EMPTY_QUALIFICATION }),
      0,
      1,
      S,
      TODAY,
    );
    expect(codes(r)).toEqual(['PAIN_MISSING', 'SPONSOR_MISSING', 'BANT_INCOMPLETE']);
    expect(r.failures[2]!.params).toMatchObject({
      missing: ['bantBudget', 'bantAuthority', 'bantNeed', 'bantTimeline'],
    });
    expect(evaluateStageGate(ctx(), 0, 1, S, TODAY).ok).toBe(true);
  });

  it('1→2 requires MEDDPICC ≥ 50 % only above USD 500 000 (P2-02)', () => {
    expect(evaluateStageGate(ctx({ amountUsd: '500000' }), 1, 2, S, TODAY).ok).toBe(true);
    const r = evaluateStageGate(ctx({ amountUsd: '500001' }), 1, 2, S, TODAY);
    expect(codes(r)).toEqual(['MEDDPICC_BELOW_50']);
    expect(
      evaluateStageGate(ctx({ amountUsd: '900000', qualification: MEDDPICC_HALF }), 1, 2, S, TODAY)
        .ok,
    ).toBe(true);
    expect(
      codes(evaluateStageGate(ctx({ qualification: EMPTY_QUALIFICATION }), 1, 2, S, TODAY)),
    ).toEqual(['BANT_INCOMPLETE']);
  });

  it('2→3 requires documented decision criteria and MEDDPICC if amount grew (P2-04/P2-06)', () => {
    expect(codes(evaluateStageGate(ctx({ decisionCriteria: ' ' }), 2, 3, S, TODAY))).toEqual([
      'DECISION_CRITERIA_MISSING',
    ]);
    expect(codes(evaluateStageGate(ctx({ amountUsd: '600000' }), 2, 3, S, TODAY))).toEqual([
      'MEDDPICC_BELOW_50',
    ]);
  });

  it('3→4: no price without economic buyer and decision date (P2-03)', () => {
    const r = evaluateStageGate(
      ctx({ hasEconomicBuyer: false, decisionDate: null, priceRequestSubmitted: false }),
      3,
      4,
      S,
      TODAY,
    );
    expect(codes(r)).toEqual([
      'ECONOMIC_BUYER_MISSING',
      'DECISION_DATE_MISSING',
      'PRICE_REQUEST_NOT_SUBMITTED',
    ]);
    expect(r.failures[0]!.params).toMatchObject({ fromStage: 3, toStage: 4 });
  });

  it('4→5 passes with a valid approval and matching milestones', () => {
    expect(evaluateStageGate(ctx(), 4, 5, S, TODAY)).toEqual({ ok: true, failures: [] });
  });

  it('4→5 blocks cash flow 20/20/50/10 vs T&C 30/50/20 (P7-02)', () => {
    const r = evaluateStageGate(ctx({ cashflowMilestones: ms([20, 20, 50, 10]) }), 4, 5, S, TODAY);
    expect(codes(r)).toEqual(['CASHFLOW_TC_MISMATCH']);
    expect(r.failures[0]!.params).toMatchObject({ cashflow: '20/20/50/10', tc: '30/50/20' });
    expect(codes(evaluateStageGate(ctx({ tcMilestones: [] }), 4, 5, S, TODAY))).toEqual([
      'MILESTONES_MISSING',
    ]);
  });

  it('4→5 approval must exist and be within 60 days (P6-05)', () => {
    expect(codes(evaluateStageGate(ctx({ approval: null }), 4, 5, S, TODAY))).toContain(
      'APPROVAL_MISSING',
    );
    expect(
      codes(
        evaluateStageGate(
          ctx({ approval: { status: 'APPROVED', expiresOn: '2026-10-31', netMargin: '0.7' } }),
          4,
          5,
          S,
          '2026-11-01',
        ),
      ),
    ).toContain('APPROVAL_EXPIRED');
    expect(
      codes(
        evaluateStageGate(
          ctx({ approval: { status: 'INVALIDATED', expiresOn: null, netMargin: null } }),
          4,
          5,
          S,
          TODAY,
        ),
      ),
    ).toContain('APPROVAL_MISSING');
    expect(
      codes(
        evaluateStageGate(
          ctx({ approval: { status: 'PENDING', expiresOn: null, netMargin: null } }),
          4,
          5,
          S,
          TODAY,
        ),
      ),
    ).toContain('APPROVAL_MISSING');
    expect(
      codes(
        evaluateStageGate(
          ctx({ approval: { status: 'EXPIRED', expiresOn: '2026-10-01', netMargin: null } }),
          4,
          5,
          S,
          TODAY,
        ),
      ),
    ).toContain('APPROVAL_EXPIRED');
  });

  it('4→5 offer validity cannot exceed approval expiry (P7-03)', () => {
    const r = evaluateStageGate(
      ctx({
        approval: { status: 'APPROVED', expiresOn: '2026-11-14', netMargin: '0.7' },
        offerValidityDays: 30,
      }),
      4,
      5,
      S,
      TODAY,
    );
    expect(codes(r)).toEqual(['OFFER_VALIDITY_EXCEEDS_APPROVAL']);
    expect(r.failures[0]!.params).toMatchObject({
      offerValidUntil: '2026-12-04',
      approvalExpiresOn: '2026-11-14',
    });
  });

  it('4→5 business case when > USD 2M or margin < 60 % (P4-01)', () => {
    expect(codes(evaluateStageGate(ctx({ amountUsd: '2500000' }), 4, 5, S, TODAY))).toEqual([
      'BUSINESS_CASE_REQUIRED',
    ]);
    expect(
      codes(
        evaluateStageGate(
          ctx({
            amountUsd: '800000',
            approval: { status: 'APPROVED', expiresOn: '2027-01-03', netMargin: '0.58' },
          }),
          4,
          5,
          S,
          TODAY,
        ),
      ),
    ).toEqual(['BUSINESS_CASE_REQUIRED']);
    expect(
      evaluateStageGate(ctx({ amountUsd: '2500000', businessCaseApproved: true }), 4, 5, S, TODAY)
        .ok,
    ).toBe(true);
  });

  it('4→5 non-economic conditions and compliance checklist (P6-03, P14-02)', () => {
    expect(
      codes(
        evaluateStageGate(ctx({ pendingConditions: ['PAYMENT_TERM_OVER_60'] }), 4, 5, S, TODAY),
      ),
    ).toEqual(['NON_ECONOMIC_PENDING']);
    const s2 = { ...S, 'compliance.requiredBeforeProposal': true };
    expect(codes(evaluateStageGate(ctx(), 4, 5, s2, TODAY))).toEqual(['COMPLIANCE_PENDING']);
    expect(evaluateStageGate(ctx({ complianceApproved: true }), 4, 5, s2, TODAY).ok).toBe(true);
  });

  it('5→6 keeps validating the approval', () => {
    expect(evaluateStageGate(ctx(), 5, 6, S, TODAY).ok).toBe(true);
    expect(codes(evaluateStageGate(ctx({ approval: null }), 5, 6, S, TODAY))).toEqual([
      'APPROVAL_MISSING',
    ]);
  });

  it('6→7 requires signed contract in repository with standard name + China ID (P7-05)', () => {
    expect(evaluateStageGate(ctx(), 6, 7, S, TODAY).ok).toBe(true);
    expect(
      codes(
        evaluateStageGate(
          ctx({ signedContract: null, chinaSystemContractId: null }),
          6,
          7,
          S,
          TODAY,
        ),
      ),
    ).toEqual(['SIGNED_CONTRACT_MISSING', 'CHINA_SYSTEM_ID_MISSING']);
    expect(
      codes(
        evaluateStageGate(
          ctx({
            signedContract: { repositoryUrl: 'https://x', standardName: 'contrato final.pdf' },
          }),
          6,
          7,
          S,
          TODAY,
        ),
      ),
    ).toEqual(['SIGNED_CONTRACT_MISSING']);
  });

  it('7→8 requires handoff with local + China delivery and ZMP id (P9-02)', () => {
    expect(evaluateStageGate(ctx(), 7, 8, S, TODAY).ok).toBe(true);
    expect(
      codes(
        evaluateStageGate(
          ctx({
            handoff: { attendeeRoles: ['LOCAL_DELIVERY'], zmpProjectId: null },
            zmpProjectId: null,
          }),
          7,
          8,
          S,
          TODAY,
        ),
      ),
    ).toEqual(['HANDOFF_MISSING', 'ZMP_ID_MISSING']);
    expect(codes(evaluateStageGate(ctx({ handoff: null }), 7, 8, S, TODAY))).toEqual([
      'HANDOFF_MISSING',
    ]);
  });

  it('9–11 are derived; jumps evaluate every intermediate gate; backwards needs a reason', () => {
    expect(codes(evaluateStageGate(ctx(), 8, 9, S, TODAY))).toEqual(['STAGE_DERIVED']);
    expect(codes(evaluateStageGate(ctx(), 10, 8, S, TODAY))).toEqual(['STAGE_DERIVED']);
    const jump = evaluateStageGate(
      ctx({ decisionCriteria: null, hasEconomicBuyer: false }),
      1,
      4,
      S,
      TODAY,
    );
    expect(codes(jump)).toEqual(['DECISION_CRITERIA_MISSING', 'ECONOMIC_BUYER_MISSING']);
    expect(codes(evaluateStageGate(ctx(), 4, 2, S, TODAY))).toEqual(['BACKWARD_REASON_REQUIRED']);
    expect(evaluateStageGate(ctx(), 4, 2, S, TODAY, { reason: 'Cliente cambió alcance' }).ok).toBe(
      true,
    );
    expect(codes(evaluateStageGate(ctx(), 3, 3, S, TODAY))).toEqual(['SAME_STAGE']);
    expect(codes(evaluateStageGate(ctx(), 3, 12, S, TODAY))).toEqual(['STAGE_INVALID']);
    expect(codes(evaluateStageGate(ctx(), 3, 4, S, TODAY, { status: 'LOST' }))).toEqual([
      'OPPORTUNITY_CLOSED',
    ]);
  });
});

describe('creation and closing', () => {
  it('requires the minimum fields and the distributor for channel origin (P1-01, CORE-02)', () => {
    expect(codes(validateOpportunityCreate({}))).toEqual([
      'FIELD_REQUIRED',
      'FIELD_REQUIRED',
      'FIELD_REQUIRED',
      'FIELD_REQUIRED',
      'FIELD_REQUIRED',
      'ENGINE_REQUIRED',
    ]);
    const base = {
      accountId: 'a',
      contactId: 'c',
      vertical: 'ROBOTICS',
      countryCode: 'CL',
      origin: 'DISTRIBUTOR',
      billingEngine: 'E',
    };
    expect(codes(validateOpportunityCreate(base))).toEqual(['DISTRIBUTOR_REQUIRED']);
    expect(validateOpportunityCreate({ ...base, distributorId: 'd' }).ok).toBe(true);
  });

  it('flags late registration beyond 2 business days (P1-02)', () => {
    const cal = toBusinessCalendar(CL_CALENDAR);
    expect(isRegisteredLate('2026-11-02', '2026-11-05', cal, 2)).toBe(true);
    expect(isRegisteredLate('2026-11-02', '2026-11-04', cal, 2)).toBe(false);
  });

  it('closing needs a reason and the winning competitor when lost (CORE-10)', () => {
    expect(codes(validateClose({ status: 'LOST' }))).toEqual([
      'CLOSE_REASON_REQUIRED',
      'WINNING_COMPETITOR_REQUIRED',
    ]);
    expect(validateClose({ status: 'DISCARDED', reason: 'Sin presupuesto' }).ok).toBe(true);
    expect(codes(validateClose({ status: 'OPEN', reason: 'x' }))).toEqual(['STATUS_INVALID']);
  });
});
