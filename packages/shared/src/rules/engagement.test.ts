import { describe, expect, it } from 'vitest';
import {
  accountEngagement,
  activityPoints,
  daysSince,
  engagementPoints,
  engagementScore,
  engagementSummary,
  recencyPoints,
  roundHalfEven,
  type EngagementInput,
} from './engagement';

const NOW = '2026-11-02T18:46:54Z';
const daysAgo = (d: number, h = 0) =>
  new Date(Date.parse(NOW) - d * 86_400_000 - h * 3_600_000).toISOString();
const base: EngagementInput = {
  inbox: 0,
  sent: 0,
  meetings: 0,
  upcoming: 0,
  lastAt: null,
  state: 'ACTIVE',
  now: NOW,
};

describe('engagement points (port of crm_scoring.py)', () => {
  it('recency curve', () => {
    expect([0, 2, 3, 5, 6, 7, 8, 14, 15, 21, 22, 30, 31, 999].map(recencyPoints)).toEqual([
      40, 40, 34, 34, 28, 28, 18, 18, 10, 10, 5, 5, 0, 0,
    ]);
  });
  it('activity volume', () => {
    expect([0, 1, 2, 3, 4, 6, 7, 10, 11, 50].map(activityPoints)).toEqual([
      0, 8, 15, 15, 22, 22, 27, 27, 30, 30,
    ]);
  });
  it('two-way dialogue truncates the balance bonus', () => {
    expect(engagementPoints(0, 0, 0)).toBe(0);
    expect(engagementPoints(3, 0, 0)).toBe(10);
    expect(engagementPoints(0, 2, 0)).toBe(10);
    expect(engagementPoints(1, 5, 0)).toBe(23); // 22 + 0.2*8 = 23.6 → 23
    expect(engagementPoints(12, 10, 0)).toBe(28); // 22 + 6.67 → 28
    expect(engagementPoints(5, 5, 0)).toBe(30);
    expect(engagementPoints(0, 0, 1)).toBe(26);
    expect(engagementPoints(2, 0, 1)).toBe(30);
  });
  it('calendar days, floor, 999 when none', () => {
    expect(daysSince(null, NOW)).toBe(999);
    expect(daysSince(daysAgo(3, 5), NOW)).toBe(3);
    expect(daysSince(daysAgo(-1), NOW)).toBe(0);
  });
  it('rounds half to even like Python', () => {
    expect([0.5, 1.5, 2.5, 56.5, 57.35, 57.6].map(roundHalfEven)).toEqual([0, 2, 2, 56, 57, 58]);
  });
});

describe('engagementScore', () => {
  it('inbound-only topic, 20 days idle → STALE 35 (legacy example)', () => {
    const r = engagementScore({ ...base, inbox: 3, lastAt: daysAgo(20) });
    expect(r).toMatchObject({ score: 35, status: 'STALE', lastDays: 20, active: true });
    expect(r.breakdown).toEqual({ recency: 10, activity: 15, engagement: 10 });
    expect(r.reason).toEqual({ code: 'IDLE_DAYS', params: { days: 20 } });
  });
  it('one recent meeting → HEALTHY 75', () => {
    const r = engagementScore({ ...base, meetings: 1, lastAt: daysAgo(3) });
    expect(r).toMatchObject({ score: 75, status: 'HEALTHY' });
  });
  it('busy two-way topic caps at 100', () => {
    const r = engagementScore({ ...base, inbox: 34, meetings: 1, lastAt: daysAgo(0) });
    expect(r.score).toBe(100);
  });
  it('bands: at risk and critical', () => {
    expect(engagementScore({ ...base, inbox: 9, lastAt: daysAgo(12) })).toMatchObject({
      score: 55,
      status: 'AT_RISK',
    });
    expect(engagementScore({ ...base, inbox: 1, lastAt: daysAgo(10) })).toMatchObject({
      score: 36,
      status: 'CRITICAL',
    });
  });
  it('a scheduled meeting prevents STALE', () => {
    const r = engagementScore({ ...base, inbox: 1, meetings: 1, upcoming: 1, lastAt: daysAgo(20) });
    expect(r.status).toBe('AT_RISK');
    expect(r.score).toBe(55);
  });
  it('dormant and scheduled', () => {
    expect(engagementScore(base)).toMatchObject({
      score: 0,
      status: 'DORMANT',
      active: false,
      reason: { code: 'NO_INTERACTION_WINDOW' },
    });
    expect(engagementScore({ ...base, upcoming: 2 })).toMatchObject({
      score: 30,
      status: 'SCHEDULED',
      active: true,
    });
  });
  it('on hold and closed topics do not count as active', () => {
    expect(
      engagementScore({ ...base, inbox: 1, lastAt: daysAgo(1), state: 'ON_HOLD' }),
    ).toMatchObject({ status: 'ON_HOLD', active: false });
    expect(
      engagementScore({ ...base, inbox: 6, sent: 6, lastAt: daysAgo(1), state: 'CLOSED' }),
    ).toMatchObject({ status: 'CLOSED', active: false, score: 100 });
  });
  it('eDo tickets: open ticket drives a topic without mail', () => {
    const r = engagementScore({
      ...base,
      tickets: [{ number: 'WOM_IS3676', status: 'OPEN', lastUpdateAt: daysAgo(40) }],
    });
    expect(r).toMatchObject({ score: 20, status: 'STALE', total: 1, active: true, lastDays: 40 });
    const fresh = engagementScore({
      ...base,
      tickets: [{ number: 'X', status: 'IN_PROGRESS', lastUpdateAt: daysAgo(3) }],
    });
    expect(fresh).toMatchObject({ score: 54, status: 'IN_PROGRESS' });
  });
  it('eDo tickets: all resolved or closed', () => {
    const t = (status: 'RESOLVED' | 'CLOSED') => ({
      number: 'X',
      status,
      lastUpdateAt: daysAgo(5),
    });
    expect(
      engagementScore({ ...base, inbox: 1, lastAt: daysAgo(24), tickets: [t('CLOSED')] }),
    ).toMatchObject({ status: 'CLOSED', active: false });
    expect(
      engagementScore({
        ...base,
        inbox: 1,
        lastAt: daysAgo(24),
        tickets: [t('CLOSED'), t('RESOLVED')],
      }),
    ).toMatchObject({ status: 'RESOLVED', active: false });
  });
  it('mail keeps priority over an open ticket', () => {
    const r = engagementScore({
      ...base,
      inbox: 5,
      lastAt: daysAgo(5),
      tickets: [{ number: 'WOM_IS3707', status: 'OPEN', lastUpdateAt: daysAgo(2) }],
    });
    expect(r).toMatchObject({ score: 66, status: 'AT_RISK', reason: { code: 'TICKET_OPEN' } });
  });
});

describe('account roll-up and summary', () => {
  const topic = (i: Partial<EngagementInput>) => {
    const input = { ...base, ...i };
    return { ...input, result: engagementScore(input) };
  };
  const topics = [
    topic({ inbox: 3, lastAt: daysAgo(20) }), // 35 stale
    topic({ meetings: 1, lastAt: daysAgo(3) }), // 75
    topic({ inbox: 1, lastAt: daysAgo(1), state: 'ON_HOLD' }),
    topic({ inbox: 6, sent: 6, lastAt: daysAgo(1), state: 'CLOSED' }),
    topic({}), // dormant
  ];
  it('mean of active topics, counts over all topics', () => {
    expect(accountEngagement(topics)).toEqual({
      score: 55,
      activeCount: 2,
      totalCount: 5,
      emails: 16,
      meetings: 1,
      upcoming: 0,
      onHold: 1,
      closed: 1,
    });
    expect(accountEngagement([topic({})]).score).toBe(0);
  });
  it('legacy Resumen cards', () => {
    expect(engagementSummary(topics.map((t) => t.result))).toEqual({
      active: 2,
      healthy: 1,
      atRisk: 0,
      critical: 1,
      stale: 1,
      onHold: 1,
    });
  });
});
