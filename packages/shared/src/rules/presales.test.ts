import { describe, expect, it } from 'vitest';
import { CL_CALENDAR, toBusinessCalendar } from '../constants/holidays';
import { DEFAULT_SETTINGS } from '../schemas/settings';
import {
  rfpAlerts,
  rfpCompliance,
  rfpDateFailures,
  rfpDates,
  rfpDeliverFailures,
  rfpKpis,
  type RfpState,
} from './presales';

const CL = toBusinessCalendar(CL_CALENDAR);
const codes = (f: { code: string }[]) => f.map((x) => x.code);

describe('P3 Preventa (QA-004)', () => {
  it('decision due in 2 business days; internal milestone 5 business days before close (P3-01/02)', () => {
    // BACKLOG P3-02: cierre 2026-12-01 → hito interno 2026-11-24
    expect(rfpDates('2026-11-04', '2026-12-01', CL, DEFAULT_SETTINGS)).toEqual({
      decisionDueOn: '2026-11-06',
      internalDeadline: '2026-11-24',
    });
    // received on Friday → decision due Tuesday; skips the 2026-12-08 holiday
    expect(rfpDates('2026-11-06', '2026-12-10', CL, DEFAULT_SETTINGS)).toEqual({
      decisionDueOn: '2026-11-10',
      internalDeadline: '2026-12-02',
    });
    expect(codes(rfpDateFailures('2026-11-04', '2026-11-03'))).toEqual(['DATE_RANGE_INVALID']);
    expect(rfpDateFailures('2026-11-04', '2026-11-04')).toEqual([]);
  });

  it('compliance % of the matrix (P3-03)', () => {
    expect(rfpCompliance([])).toEqual({ total: 0, answered: 0, pct: null });
    expect(rfpCompliance(['COMPLIES', 'PARTIAL', 'NOT_COMPLIES', 'PENDING'])).toEqual({
      total: 4,
      answered: 3,
      pct: 0.375,
    });
  });

  it('delivery requires participate, the full matrix and the CM review (P3-04)', () => {
    expect(
      codes(rfpDeliverFailures({ decision: 'PENDING', cmReviewedAt: null, deliveredOn: null }, 2)),
    ).toEqual(['RFP_DECISION_REQUIRED', 'RFP_REQUIREMENTS_PENDING', 'RFP_CM_REVIEW_REQUIRED']);
    expect(
      rfpDeliverFailures(
        { decision: 'PARTICIPATE', cmReviewedAt: '2026-11-20T12:00:00Z', deliveredOn: null },
        0,
      ),
    ).toEqual([]);
    expect(
      codes(
        rfpDeliverFailures(
          { decision: 'PARTICIPATE', cmReviewedAt: '2026-11-20', deliveredOn: '2026-11-21' },
          0,
        ),
      ),
    ).toEqual(['RFP_ALREADY_DELIVERED']);
  });

  it('alerts: decision overdue, internal milestone due/overdue, client deadline missed', () => {
    const base = {
      decision: 'PENDING' as const,
      decisionDueOn: '2026-11-06',
      internalDeadline: '2026-11-24',
      clientDeadline: '2026-12-01',
      deliveredOn: null,
    };
    expect(rfpAlerts(base, '2026-11-06')).toEqual([]);
    expect(rfpAlerts(base, '2026-11-09')).toEqual(['DECISION_OVERDUE']);
    const p = { ...base, decision: 'PARTICIPATE' as const };
    expect(rfpAlerts(p, '2026-11-24')).toEqual(['INTERNAL_DUE']);
    expect(rfpAlerts(p, '2026-11-25')).toEqual(['INTERNAL_OVERDUE']);
    expect(rfpAlerts(p, '2026-12-02')).toEqual(['CLIENT_DEADLINE_MISSED']);
    expect(rfpAlerts({ ...p, deliveredOn: '2026-11-30' }, '2026-12-02')).toEqual([]);
  });

  it('KPIs: RFPs on time and win rate (KPIS.md §4 P3)', () => {
    const r = (o: Partial<RfpState>): RfpState => ({
      decision: 'PARTICIPATE',
      decisionDueOn: '2026-11-06',
      decidedOn: '2026-11-05',
      internalDeadline: '2026-11-24',
      clientDeadline: '2026-12-01',
      deliveredOn: null,
      result: 'PENDING',
      ...o,
    });
    const k = rfpKpis([
      r({ deliveredOn: '2026-11-30', result: 'WON' }),
      r({ deliveredOn: '2026-12-02', result: 'LOST', decidedOn: '2026-11-09' }),
      r({ deliveredOn: '2026-12-01', result: 'LOST' }),
      r({ decision: 'DECLINE' }),
      r({ decision: 'PENDING', decidedOn: null }),
    ]);
    expect(k).toEqual({
      delivered: 3,
      onTimePct: 0.6667,
      decided: 4,
      decisionOnTimePct: 0.75,
      withResult: 3,
      winRate: 0.3333,
    });
    expect(rfpKpis([])).toMatchObject({ onTimePct: null, winRate: null, decisionOnTimePct: null });
  });
});
