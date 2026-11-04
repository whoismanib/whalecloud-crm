import { describe, expect, it } from 'vitest';
import { isBusinessCaseRequired, validateBusinessCaseSubmission } from './businessCase';
import { D, fraction, money, result } from './common';
import {
  pipelineCoverage,
  stageProbability,
  unweightedQualifiedPipeline,
  weightedPipeline,
} from './coverage';
import { convert, moneyEquivalents, resolveRate, type FxRate } from './fx';
import { legacyGoalBucket, legacyStatusToStage, stageToLegacyStatus } from './legacyStatus';
import {
  buildRepositoryName,
  normalizeSegment,
  parseRepositoryName,
  validateRepositoryName,
} from './naming';
import { validatePriceRequest } from './priceRequest';
import {
  bantComplete,
  EMPTY_QUALIFICATION,
  meddpiccRequired,
  meddpiccScore,
} from './qualification';
import { LEGACY_STATUSES } from '../enums';
import { DEFAULT_SETTINGS, resolveSettings } from '../schemas/settings';

const S = DEFAULT_SETTINGS;

describe('qualification (P2-01/P2-02)', () => {
  it('BANT complete and MEDDPICC score', () => {
    expect(bantComplete(EMPTY_QUALIFICATION)).toBe(false);
    const q = {
      ...EMPTY_QUALIFICATION,
      bantBudget: 'COMPLETE' as const,
      bantAuthority: 'COMPLETE' as const,
      bantNeed: 'COMPLETE' as const,
      bantTimeline: 'COMPLETE' as const,
      mMetrics: 'COMPLETE' as const,
      mChampion: 'PARTIAL' as const,
    };
    expect(bantComplete(q)).toBe(true);
    expect(meddpiccScore(q)).toBe(0.188);
    expect(meddpiccScore(EMPTY_QUALIFICATION)).toBe(0);
  });
  it('MEDDPICC mandatory strictly above USD 500 000', () => {
    expect(meddpiccRequired('500000', S)).toBe(false);
    expect(meddpiccRequired('500000.01', S)).toBe(true);
    expect(meddpiccRequired(null, S)).toBe(false);
  });
});

describe('business case (P4-01/P4-02)', () => {
  it('required for USD 2.5M or margin 58 %', () => {
    expect(isBusinessCaseRequired('2500000', '0.7', S)).toBe(true);
    expect(isBusinessCaseRequired('800000', '0.58', S)).toBe(true);
    expect(isBusinessCaseRequired('2000000', '0.6', S)).toBe(false);
    expect(isBusinessCaseRequired(null, null, S)).toBe(false);
  });
  it('TCO horizon 3–5 years mandatory on submission', () => {
    const ok = {
      pain: 'p',
      baselineMetric: 'b',
      benefit: 'x',
      tcoHorizonYears: 4,
      tco: '1000',
      risks: 'r',
    };
    expect(validateBusinessCaseSubmission(ok)).toEqual([]);
    expect(validateBusinessCaseSubmission({ ...ok, tcoHorizonYears: null })).toEqual([
      { code: 'TCO_HORIZON_REQUIRED' },
    ]);
    expect(validateBusinessCaseSubmission({}).map((f) => f.code)).toContain('FIELD_REQUIRED');
  });
});

describe('price request A1 + 4 data (P5-01/P5-02)', () => {
  const full = {
    countryCode: 'CL',
    accountId: 'a',
    relationshipType: 'NEW_CUSTOMER',
    competitionType: 'TENDER_3_PLUS',
    salesOwnerId: 'u',
    solutionOwnerName: 'Lin Han',
    deliveryOwnerName: 'Delivery CN',
    projectStageLabel: 'Solución',
    projectLevel: 'A',
    budget: '1000000',
    signingModel: 'SINGLE_CL_SPA',
    currency: 'USD',
    warrantyMonths: 12,
    summary: 's',
    strategy: 's',
    mainCompetitor: 'Huawei',
    risks: 'r',
    scopeSummary: 'BRD v2',
    billingEngine: 'A',
    targetPrice: '1800000',
    targetCompetitor: 'Huawei',
    expectedMilestones: [{ pct: 30 }, { pct: 50 }, { pct: 20 }],
  };
  it('complete request passes', () => expect(validatePriceRequest(full)).toEqual([]));
  it('any empty A1 field blocks; milestones must sum 100', () => {
    const f = validatePriceRequest({
      ...full,
      strategy: ' ',
      warrantyMonths: null,
      scopeSummary: null,
      billingEngine: null,
      targetPrice: '0',
      expectedMilestones: [{ pct: 50 }],
    });
    expect(f.map((x) => x.code)).toEqual([
      'A1_INCOMPLETE',
      'SCOPE_REQUIRED',
      'ENGINE_REQUIRED',
      'TARGET_PRICE_REQUIRED',
      'MILESTONES_NOT_100',
    ]);
    expect(f[0]!.params).toEqual({ fields: ['warrantyMonths', 'strategy'] });
  });
});

describe('pipeline coverage (KPI 7)', () => {
  const probs = S['forecast.stageProbabilities'];
  const opps = [
    { stage: 0, status: 'OPEN', amount: 1000, expectedCloseDate: '2026-12-01' },
    { stage: 1, status: 'OPEN', amount: 1000, expectedCloseDate: '2026-12-01' },
    { stage: 4, status: 'OPEN', amount: 1000, expectedCloseDate: '2026-12-01' },
    { stage: 6, status: 'OPEN', amount: 1000, expectedCloseDate: '2026-12-31' },
    { stage: 6, status: 'OPEN', amount: 1000, expectedCloseDate: '2027-01-01' },
    { stage: 5, status: 'LOST', amount: 1000, expectedCloseDate: '2026-12-01' },
    { stage: 7, status: 'OPEN', amount: 1000, expectedCloseDate: '2026-12-01' },
  ];
  it('weights by stage probability and excludes lead, closed, won and next year', () => {
    expect(weightedPipeline(opps, probs, '2026-12-31')).toBe('1200.00');
    expect(unweightedQualifiedPipeline(opps, '2026-12-31')).toBe('3000.00');
    expect(stageProbability(0, probs)).toBe(0);
  });
  it('coverage = pipeline / (target − signed)', () => {
    expect(pipelineCoverage({ pipeline: '300', target: '200', signedYtd: '100' })).toEqual({
      ratio: '3.00',
      remaining: '100.00',
      reached: false,
    });
    expect(pipelineCoverage({ pipeline: '1', target: '100', signedYtd: '120' }).reached).toBe(true);
    expect(pipelineCoverage({ pipeline: '1', target: null, signedYtd: '0' }).ratio).toBeNull();
  });
});

describe('FX (CORE-04)', () => {
  const table: FxRate[] = [
    { month: '2026-10-01', currency: 'CNY', unitsPerUsd: '7.10' },
    { month: '2026-10-01', currency: 'CLP', unitsPerUsd: '940' },
    { month: '2026-11-01', currency: 'CNY', unitsPerUsd: '7.20' },
  ];
  it('uses the event month rate; missing month → last available, provisional', () => {
    expect(resolveRate('2026-11-15', 'CNY', table)).toMatchObject({
      month: '2026-11-01',
      provisional: false,
    });
    const clp = resolveRate('2026-11-15', 'CLP', table);
    expect(clp.month).toBe('2026-10-01');
    expect(clp.provisional).toBe(true);
    expect(resolveRate('2026-11-15', 'USD', table).rate.toNumber()).toBe(1);
    expect(resolveRate('2026-01-15', 'CNY', table)).toMatchObject({
      month: '2026-10-01',
      provisional: true,
    });
    expect(() => resolveRate('2026-11-15', 'COP', table)).toThrow('FX_RATE_MISSING');
  });
  it('converts via USD pivot and computes equivalents', () => {
    expect(convert('940000', 'CLP', 'USD', '2026-10-10', table)).toEqual({
      amount: '1000.00',
      provisional: false,
    });
    expect(convert('100', 'USD', 'USD', '2026-10-10', table).amount).toBe('100.00');
    const eq = moneyEquivalents('1000', 'USD', '2026-11-04', table);
    expect(eq).toEqual({
      usd: '1000.00',
      cny: '7200.00',
      clp: '940000',
      fxMonth: '2026-11-01',
      fxProvisional: true,
    });
  });
});

describe('repository naming standard (CORE-07)', () => {
  it('parses CL_WOM_OC_4500123_v1_2026-11-04.pdf', () => {
    expect(parseRepositoryName('CL_WOM_OC_4500123_v1_2026-11-04.pdf')).toEqual({
      country: 'CL',
      client: 'WOM',
      type: 'OC',
      number: '4500123',
      version: 'v1',
      date: '2026-11-04',
      ext: 'pdf',
    });
    expect(validateRepositoryName('contrato final.pdf')[0]!.code).toBe('NAMING_INVALID');
    expect(parseRepositoryName('CL_WOM_XX_1_v1_2026-11-04.pdf')).toBeNull();
    expect(parseRepositoryName('CL_WOM_OC_1_v1_2026-02-31.pdf')).not.toBeNull(); // regex-valid
  });
  it('builds a standard name from record data', () => {
    expect(
      buildRepositoryName({
        country: 'cl',
        client: 'Banco Estado',
        type: 'AC',
        number: 'H2 UAT',
        version: 1,
        date: '2026-11-04',
        ext: '.PDF',
      }),
    ).toBe('CL_BANCO-ESTADO_AC_H2-UAT_v1_2026-11-04.pdf');
    expect(normalizeSegment('Equifiber Ñuñoa')).toBe('EQUIFIBER-NUNOA');
    expect(() =>
      buildRepositoryName({
        country: 'CL',
        client: 'X',
        type: 'ZZ' as never,
        number: '1',
        version: 'v1',
        date: '2026-01-01',
        ext: 'pdf',
      }),
    ).toThrow();
    expect(
      parseRepositoryName(
        buildRepositoryName({
          country: 'CL',
          client: 'GTD',
          type: 'SOW',
          number: '',
          version: 'v2.1',
          date: '2026-01-01',
          ext: 'docx',
        }),
      ),
    ).toMatchObject({ number: 'NA', version: 'v2.1' });
  });
});

describe('legacy tracker mapping (LEGACY-DASHBOARD)', () => {
  it('maps every legacy status', () => {
    expect(legacyStatusToStage('Preparing RFP')).toEqual({ stage: 3, status: 'OPEN' });
    expect(legacyStatusToStage('Preparing TP')).toEqual({ stage: 4, status: 'OPEN' });
    expect(legacyStatusToStage('RFP Sent').stage).toBe(5);
    expect(legacyStatusToStage('TP Sent').stage).toBe(5);
    expect(legacyStatusToStage('PVB').stage).toBe(6);
    expect(legacyStatusToStage('Voucher').stage).toBe(7);
    expect(legacyStatusToStage('PO').stage).toBe(7);
    expect(legacyStatusToStage('Cancelled')).toEqual({ stage: null, status: 'LOST' });
    for (const s of LEGACY_STATUSES) expect(legacyStatusToStage(s)).toBeDefined();
  });
  it('reverse mapping and goal buckets', () => {
    expect(stageToLegacyStatus(9, 'OPEN')).toBe('PO');
    expect(stageToLegacyStatus(6, 'OPEN')).toBe('PVB');
    expect(stageToLegacyStatus(5, 'OPEN')).toBe('TP Sent');
    expect(stageToLegacyStatus(4, 'OPEN')).toBe('Preparing TP');
    expect(stageToLegacyStatus(3, 'OPEN')).toBe('Preparing RFP');
    expect(stageToLegacyStatus(1, 'OPEN')).toBeNull();
    expect(stageToLegacyStatus(4, 'LOST')).toBe('Cancelled');
    expect(legacyGoalBucket(7, 'OPEN')).toBe('CLOSED');
    expect(legacyGoalBucket(4, 'OPEN')).toBe('IN_FLIGHT');
    expect(legacyGoalBucket(1, 'OPEN')).toBe('EARLY');
    expect(legacyGoalBucket(4, 'DISCARDED')).toBe('CANCELLED');
  });
});

describe('settings and helpers', () => {
  it('resolves stored settings over defaults and validates them', () => {
    const s = resolveSettings({ 'approval.validDays': 30, unknown: 1 });
    expect(s['approval.validDays']).toBe(30);
    expect(s['approval.thresholds'].president).toBe(0.6);
    expect(() => resolveSettings({ 'approval.validDays': -1 })).toThrow();
  });
  it('decimal helpers', () => {
    expect(money('1.005')).toBe('1.01');
    expect(fraction(0.5)).toBe('0.500000');
    expect(D(null).toNumber()).toBe(0);
    expect(result([])).toEqual({ ok: true, failures: [] });
  });
});
