import { describe, expect, it } from 'vitest';
import { healthBand, healthScore } from './health';
import {
  median,
  paymentsTotal,
  pendingAcceptances,
  priceTime,
  profit,
  rag,
  receivablesAging,
  recognizedRevenue,
  ssSigned,
  yearPace,
} from './kpis';
import { CL_CALENDAR, CN_CALENDAR, toBusinessCalendar } from '../constants/holidays';
import { DEFAULT_SETTINGS } from '../schemas/settings';
import {
  can,
  canViewOpportunity,
  DEFAULT_RACI,
  hasActionRole,
  lettersFor,
  visibleStages,
} from '../permissions';
import { stageCode, stageProcesses, transitionProcess } from '../constants/stages';

const CL = toBusinessCalendar(CL_CALENDAR);
const CN = toBusinessCalendar(CN_CALENDAR);
const FROM = '2026-01-01';
const TO = '2026-12-31';

describe('KPIs (KPIS.md §3)', () => {
  it('KPI 1/2/6: S&S signed, mix and digital; NDA and non-won excluded', () => {
    const base = {
      countsForSs: true,
      opportunityWon: true,
      countsAsDigital: false,
      customerTypeFrozen: 'EXISTING' as const,
    };
    const r = ssSigned(
      [
        { ...base, type: 'OC', signedOn: '2026-03-01', amount: '100', countsAsDigital: true },
        { ...base, type: 'SOW', signedOn: '2026-05-01', amount: '50', customerTypeFrozen: 'NEW' },
        { ...base, type: 'NDA', signedOn: '2026-05-01', amount: '999' },
        { ...base, type: 'MSA', signedOn: '2026-05-01', amount: '999', countsForSs: false },
        { ...base, type: 'CR', signedOn: '2025-12-31', amount: '999' },
        { ...base, type: 'CR', signedOn: '2026-06-01', amount: '999', opportunityWon: false },
      ],
      FROM,
      TO,
    );
    expect(r).toEqual({
      total: '150.00',
      newCustomers: '50.00',
      existingCustomers: '100.00',
      newPct: 0.3333,
      digital: '100.00',
    });
    expect(ssSigned([], FROM, TO).newPct).toBeNull();
  });

  it('KPI 3/4/5: payments, recognized revenue and profit', () => {
    expect(
      paymentsTotal(
        [
          { paidOn: '2026-02-01', amount: 10 },
          { paidOn: '2025-02-01', amount: 10 },
        ],
        FROM,
        TO,
      ),
    ).toBe('10.00');
    expect(
      recognizedRevenue(
        [
          { recognizedOn: '2026-02-01', amount: 5 },
          { recognizedOn: null, amount: 5 },
        ],
        FROM,
        TO,
      ),
    ).toBe('5.00');
    expect(
      profit(
        [{ wonOn: '2026-03-01', price: 1881878, cost: 686772, commercialCosts: 248234 }],
        FROM,
        TO,
      ),
    ).toEqual({
      profit: '946872.00',
      pct: 0.5032,
    });
    expect(profit([], FROM, TO).pct).toBeNull();
  });

  it('KPI 8: pending acceptances older than 10 business days', () => {
    const r = pendingAcceptances(
      [
        { readyOn: '2026-10-01', acSignedAt: null, receptionAt: null, amount: 100 },
        { readyOn: '2026-11-03', acSignedAt: null, receptionAt: null, amount: 50 },
        { readyOn: '2026-10-01', acSignedAt: '2026-10-05', receptionAt: '2026-10-06', amount: 70 },
        { readyOn: null, acSignedAt: null, receptionAt: null, amount: 70 },
      ],
      '2026-11-04',
      CL,
      10,
    );
    expect(r).toEqual({ count: 1, amount: '100.00', allPending: 2 });
  });

  it('KPI 9: receivables aging with > 30 days overdue', () => {
    const r = receivablesAging(
      [
        { dueOn: '2026-09-01', balance: 100 },
        { dueOn: '2026-11-01', balance: 20 },
        { dueOn: '2026-12-01', balance: 30 },
        { dueOn: '2026-09-01', balance: 0 },
      ],
      '2026-11-04',
    );
    expect(r.over30).toEqual({ count: 1, amount: '100.00' });
    expect(r.buckets['1-7']).toEqual({ count: 1, amount: '20.00' });
    expect(r.buckets.CURRENT.count).toBe(1);
  });

  it('KPI 10: price time median/avg in business days (China calendar)', () => {
    const r = priceTime(
      [
        { type: 'PROJECT', submittedOn: '2026-10-12', sheetApprovedOn: '2026-10-22' },
        { type: 'PROJECT', submittedOn: '2026-10-12', sheetApprovedOn: '2026-10-30' },
        { type: 'CR', submittedOn: '2026-10-12', sheetApprovedOn: '2026-10-14' },
        { type: 'PROJECT', submittedOn: '2026-10-12', sheetApprovedOn: null },
      ],
      '2026-08-12',
      '2026-11-04',
      CN,
    );
    expect(r.count).toBe(2);
    expect(r.median).toBe(11);
    expect(r.pctWithin).toBe(0.5);
    expect(priceTime([], FROM, TO, CN).median).toBeNull();
    expect(
      priceTime(
        [{ type: 'CR', submittedOn: '2026-10-12', sheetApprovedOn: '2026-10-14' }],
        FROM,
        TO,
        CN,
        5,
        'CR',
      ).count,
    ).toBe(1);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([])).toBeNull();
  });

  it('traffic light vs linear pace; zero-target KPIs; no target → NONE', () => {
    expect(yearPace('2026-07-02')).toBeCloseTo(26 / 52, 5);
    expect(rag('100', '200', 'PACE', { pace: 0.5 })).toBe('GREEN');
    expect(rag('90', '200', 'PACE', { pace: 0.5 })).toBe('AMBER');
    expect(rag('50', '200', 'PACE', { pace: 0.5 })).toBe('RED');
    expect(rag('0', '0', 'ZERO')).toBe('GREEN');
    expect(rag('2', '0', 'ZERO')).toBe('RED');
    expect(rag('5', null, 'PACE')).toBe('NONE');
    expect(rag(null, '5', 'PACE')).toBe('NONE');
    expect(rag('9', '10', 'MAX')).toBe('GREEN');
    expect(rag('11', '10', 'MAX')).toBe('AMBER');
    expect(rag('20', '10', 'MAX')).toBe('RED');
    expect(rag('3', '3', 'MIN')).toBe('GREEN');
    expect(rag('2.6', '3', 'MIN')).toBe('AMBER');
    expect(rag('1', '3', 'MIN')).toBe('RED');
  });
});

describe('health score (legacy "Salud CRM")', () => {
  const S = DEFAULT_SETTINGS;
  const base = {
    status: 'OPEN' as const,
    stage: 4,
    lastActivityOn: '2026-11-03',
    lastUpdatedOn: '2026-11-02',
    expectedCloseDate: '2026-12-15',
    overdueSlaCount: 0,
    risk: 'LOW' as const,
    today: '2026-11-04',
  };
  it('thresholds: healthy ≥ 70, at risk 40–69, critical < 40', () => {
    expect(healthBand(70)).toBe('HEALTHY');
    expect(healthBand(69)).toBe('AT_RISK');
    expect(healthBand(40)).toBe('AT_RISK');
    expect(healthBand(39)).toBe('CRITICAL');
  });
  it('recent activity, no issues → healthy 100', () => {
    expect(healthScore(base, CL, S)).toMatchObject({
      score: 100,
      status: 'HEALTHY',
      idleBusinessDays: 1,
    });
  });
  it('penalises close date passed, overdue SLAs and risk', () => {
    const r = healthScore(
      { ...base, expectedCloseDate: '2026-10-01', overdueSlaCount: 2, risk: 'HIGH' },
      CL,
      S,
    );
    expect(r.score).toBe(30);
    expect(r.status).toBe('CRITICAL');
    expect(r.reasons.map((x) => x.code)).toEqual(['CLOSE_DATE_PASSED', 'SLA_OVERDUE', 'RISK_HIGH']);
    expect(
      healthScore(
        { ...base, risk: 'MEDIUM', lastActivityOn: null, lastUpdatedOn: '2026-10-26' },
        CL,
        S,
      ),
    ).toMatchObject({
      score: 70,
      status: 'HEALTHY',
    });
  });
  it('stale when idle beyond the threshold (business days)', () => {
    const r = healthScore(
      { ...base, lastActivityOn: '2026-10-14', lastUpdatedOn: '2026-10-14' },
      CL,
      S,
    );
    expect(r.status).toBe('STALE');
    expect(r.score).toBe(75);
    expect(
      healthScore({ ...base, lastActivityOn: '2026-09-01', lastUpdatedOn: '2026-09-01' }, CL, S)
        .score,
    ).toBe(60);
    expect(
      healthScore({ ...base, lastActivityOn: '2026-10-26', lastUpdatedOn: '2026-10-26' }, CL, S)
        .score,
    ).toBe(90);
  });
  it('closed and on hold', () => {
    expect(healthScore({ ...base, status: 'LOST' }, CL, S).status).toBe('CLOSED');
    expect(healthScore({ ...base, stage: 11 }, CL, S).status).toBe('CLOSED');
    expect(healthScore({ ...base, onHold: true }, CL, S).status).toBe('ON_HOLD');
  });
});

describe('permissions from RACI (ADM-02)', () => {
  it('letters → actions, union of roles', () => {
    expect(lettersFor(['COUNTRY_MANAGER'], 'P12', DEFAULT_RACI)).toEqual(['R', 'A']);
    expect(can(['ACCOUNT_MANAGER'], 'P5', 'write')).toBe(true);
    expect(can(['VP'], 'P5', 'write')).toBe(false); // Jacky: I in P5 → read only
    expect(can(['VP'], 'P5', 'view')).toBe(true);
    expect(can(['VP'], 'P6', 'approve')).toBe(true);
    expect(can(['CHINA_LEGAL'], 'P1', 'view')).toBe(false);
    expect(can(['CHINA_LEGAL', 'ACCOUNT_MANAGER'], 'P1', 'write')).toBe(true);
    expect(can(['ADMIN'], 'P6', 'approve')).toBe(false);
    expect(can(['ADMIN'], 'ADM', 'approve')).toBe(true);
    expect(can(['CHINA_SALES'], 'P3', 'comment')).toBe(true);
  });
  it('action restrictions', () => {
    expect(hasActionRole(['CHINA_FINANCE'], 'P8.invoice.write')).toBe(true);
    expect(hasActionRole(['ACCOUNT_MANAGER'], 'P8.invoice.write')).toBe(false);
  });
  it('Legal China does not see a stage-0 opportunity unless assigned', () => {
    expect(visibleStages(['CHINA_LEGAL'])).not.toContain(0);
    expect(
      canViewOpportunity(['CHINA_LEGAL'], { stage: 0, countryCode: 'CL' }, { countryCodes: ['*'] }),
    ).toBe(false);
    expect(
      canViewOpportunity(
        ['CHINA_LEGAL'],
        { stage: 0, countryCode: 'CL' },
        { countryCodes: [], assigned: true },
      ),
    ).toBe(true);
    expect(
      canViewOpportunity(['CHINA_LEGAL'], { stage: 5, countryCode: 'CO' }, { countryCodes: [] }),
    ).toBe(true);
    expect(
      canViewOpportunity(
        ['ACCOUNT_MANAGER'],
        { stage: 0, countryCode: 'CO' },
        { countryCodes: ['CL'] },
      ),
    ).toBe(false);
    expect(
      canViewOpportunity(
        ['ACCOUNT_MANAGER'],
        { stage: 0, countryCode: 'CL' },
        { countryCodes: ['CL'] },
      ),
    ).toBe(true);
  });
  it('stage helpers', () => {
    expect(stageCode(4)).toBe('PRICE_REQUESTED');
    expect(() => stageCode(12)).toThrow();
    expect(stageProcesses(5)).toEqual(['P6', 'P7']);
    expect(stageProcesses(10)).toEqual(['P8']);
    expect(() => stageProcesses(12)).toThrow();
    expect([0, 1, 3, 4, 6, 8, 10].map(transitionProcess)).toEqual([
      'P1',
      'P2',
      'P3',
      'P5',
      'P7',
      'P9',
      'P8',
    ]);
  });
});
