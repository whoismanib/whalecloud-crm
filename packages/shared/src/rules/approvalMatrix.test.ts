import { describe, expect, it } from 'vitest';
import {
  bandForLine,
  mostRestrictive,
  routeApproval,
  validateApprovalRequest,
  type ApprovalSettings,
} from './approvalMatrix';
import { detectConditions } from './nonEconomicConditions';
import type { LineItemInput } from './margins';
import { DEFAULT_SETTINGS } from '../schemas/settings';

const S: ApprovalSettings = DEFAULT_SETTINGS;
const T = S['approval.thresholds'];

/** Builds a line whose net-income margin is exactly `m` (net income 100 000). */
function line(lineNo: number, itemType: LineItemInput['itemType'], m: number): LineItemInput {
  const ni = 100000;
  return {
    lineNo,
    itemType,
    cost: String(Math.round(ni * (1 - m) * 100) / 100),
    priceExTax: String(ni),
    netIncome: String(ni),
    commercialCosts: '0',
  };
}

describe('bandForLine', () => {
  it.each([
    [0.7, 0.68, 'COMMITTEE'],
    [0.68, 0.68, 'COMMITTEE'],
    [0.6384, 0.68, 'PRESIDENT'],
    [0.6, 0.68, 'PRESIDENT'],
    [0.5999, 0.68, 'VP'],
    [0.55, 0.65, 'VP'],
    [0.5, 0.65, 'VP'],
    [0.48, 0.65, 'NOT_QUOTABLE'],
  ] as const)('margin %s target %s → %s', (m, t, band) => {
    expect(bandForLine(m, t, T)).toBe(band);
  });
  it('null margin is not quotable', () => expect(bandForLine(null, 0.6, T)).toBe('NOT_QUOTABLE'));
  it('most restrictive wins', () => {
    expect(mostRestrictive(['COMMITTEE', 'VP', 'PRESIDENT'])).toBe('VP');
    expect(mostRestrictive([])).toBe('COMMITTEE');
  });
});

describe('routeApproval (P6-02, P6-03)', () => {
  it('all lines on target → China pricing committee', () => {
    const r = routeApproval(
      [line(1, 'OWN_SOFTWARE', 0.66), line(2, 'IMPLEMENTATION', 0.64)],
      [],
      S,
    );
    expect(r.band).toBe('COMMITTEE');
    expect(r.steps).toEqual([
      expect.objectContaining({ kind: 'MARGIN_COMMITTEE', assigneeRole: 'CHINA_SALES' }),
    ]);
    expect(r.requiresCompetitiveJustification).toBe(false);
    expect(r.requiresBusinessCase).toBe(false);
  });

  it('L2 at 63.84 % (target 68 %) and rest on target → Alex Xiao with justification', () => {
    const r = routeApproval(
      [line(1, 'OWN_SOFTWARE', 0.66), line(2, 'SUPPORT_L3', 0.8), line(4, 'SUPPORT_L1L2', 0.6384)],
      [],
      S,
    );
    expect(r.band).toBe('PRESIDENT');
    expect(r.steps[0]).toMatchObject({ kind: 'MARGIN_PRESIDENT', assigneeRole: 'LATAM_PRESIDENT' });
    expect(r.requiresCompetitiveJustification).toBe(true);
    expect(r.lines.find((l) => l.lineNo === 4)?.band).toBe('PRESIDENT');
    expect(r.minLineMargin).toBe('0.638400');
    expect(validateApprovalRequest(r, { businessCaseApproved: false })).toEqual([
      { code: 'JUSTIFICATION_REQUIRED' },
    ]);
    expect(
      validateApprovalRequest(r, {
        competitiveJustification: 'Huawei',
        businessCaseApproved: false,
      }),
    ).toEqual([]);
  });

  it('one line at 55 % → Jacky (VP) and business case required; president informed', () => {
    const r = routeApproval([line(1, 'OWN_SOFTWARE', 0.7), line(2, 'IMPLEMENTATION', 0.55)], [], S);
    expect(r.band).toBe('VP');
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0]).toMatchObject({ kind: 'MARGIN_VP', assigneeRole: 'VP' });
    expect(r.steps[0]!.informedRoles).toContain('LATAM_PRESIDENT');
    expect(r.steps[0]!.consultedRoles).toContain('CHINA_FINANCE');
    expect(r.requiresBusinessCase).toBe(true);
    expect(validateApprovalRequest(r, { businessCaseApproved: false })).toEqual([
      { code: 'BUSINESS_CASE_REQUIRED' },
    ]);
  });

  it('president co-approves the VP band when configured', () => {
    const r = routeApproval([line(1, 'IMPLEMENTATION', 0.55)], [], {
      ...S,
      'approval.presidentCoApprovesVpBand': true,
    });
    expect(r.steps.map((s) => s.kind)).toEqual(['MARGIN_VP', 'VP_CO_APPROVAL']);
  });

  it('one line at 48 % → not quotable, blocked', () => {
    const r = routeApproval([line(1, 'OWN_SOFTWARE', 0.7), line(3, 'IMPLEMENTATION', 0.48)], [], S);
    expect(r.band).toBe('NOT_QUOTABLE');
    expect(r.blocked).toBe(true);
    expect(r.steps).toEqual([]);
    expect(r.failures).toEqual([{ code: 'NOT_QUOTABLE_BELOW_50', params: { lines: ['3'] } }]);
    expect(validateApprovalRequest(r, { businessCaseApproved: true })[0]?.code).toBe(
      'NOT_QUOTABLE_BELOW_50',
    );
  });

  it('payment term 90 days adds a non-economic step even with margins on target', () => {
    const conditions = detectConditions({ paymentTermDays: 90 }, S);
    expect(conditions).toEqual(['PAYMENT_TERM_OVER_60']);
    const r = routeApproval([line(1, 'OWN_SOFTWARE', 0.7)], conditions, S);
    expect(r.band).toBe('COMMITTEE');
    expect(r.steps.map((s) => s.kind)).toEqual(['MARGIN_COMMITTEE', 'NON_ECONOMIC']);
    expect(r.steps[1]).toMatchObject({
      assigneeRole: 'LATAM_PRESIDENT',
      condition: 'PAYMENT_TERM_OVER_60',
      consultedRoles: ['CHINA_FINANCE'],
    });
  });

  it('routes on contract margin when the basis is configured as CONTRACT', () => {
    const item: LineItemInput = {
      lineNo: 1,
      itemType: 'OWN_SOFTWARE',
      cost: '30000',
      priceExTax: '100000',
      netIncome: '100000',
      commercialCosts: '15000',
    };
    expect(routeApproval([item], [], S).band).toBe('COMMITTEE'); // net 70 %
    expect(routeApproval([item], [], { ...S, 'approval.marginBasis': 'CONTRACT' }).band).toBe('VP'); // contract 55 %
  });

  it('configurable thresholds (60 → 62 %) change routing', () => {
    const s2 = { ...S, 'approval.thresholds': { president: 0.62, vp: 0.5 } };
    expect(routeApproval([line(1, 'SUPPORT_L1L2', 0.61)], [], S).band).toBe('PRESIDENT');
    expect(routeApproval([line(1, 'SUPPORT_L1L2', 0.61)], [], s2).band).toBe('VP');
  });

  it('no line items is blocked', () => {
    const r = routeApproval([], [], S);
    expect(r.blocked).toBe(true);
    expect(r.failures[0]?.code).toBe('LINE_ITEMS_REQUIRED');
    expect(r.minLineMargin).toBeNull();
  });
});

describe('detectConditions', () => {
  it('detects all four non-economic conditions', () => {
    expect(
      detectConditions(
        {
          paymentTermDays: 61,
          clpWithoutFxPremium: true,
          penaltyCapPct: '0.15',
          unlimitedLiability: true,
        },
        S,
      ),
    ).toEqual([
      'PAYMENT_TERM_OVER_60',
      'CLP_WITHOUT_FX_PREMIUM',
      'PENALTY_OVER_10',
      'UNLIMITED_LIABILITY',
    ]);
  });
  it('limits are inclusive (60 days, 10 %)', () => {
    expect(detectConditions({ paymentTermDays: 60, penaltyCapPct: 0.1 }, S)).toEqual([]);
    expect(detectConditions({}, S)).toEqual([]);
  });
});
