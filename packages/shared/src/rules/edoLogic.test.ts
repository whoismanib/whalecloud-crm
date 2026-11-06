import { describe, expect, it } from 'vitest';
import sample from './__fixtures__/edo_incidents.sample.json';
import {
  EDO_DEFAULT_CONFIG as cfg,
  businessHours,
  edoBall,
  edoEnrich,
  edoGroupSummary,
  edoKpis,
  edoPushGroups,
  edoRecordOf,
  edoSlaState,
  edoStaleInfo,
  edoTrends,
  type EdoRecord,
} from './edoLogic';

// Parity with the legacy `edo_logic.js` was checked on the real 3,440-ticket file at a fixed
// "now" (every KPI, push group, trend and per-ticket SLA/stale/ball matched). These cases pin
// the rules on small synthetic rows.
const T = (p: Partial<EdoRecord>): EdoRecord => ({
  id: 'X',
  no: 'WOM_IS1',
  title: 't',
  priority: 'P2',
  status: 1,
  open: true,
  org: 'WhaleCloudSupport',
  side: 'Whale',
  created: '2026-11-02T09:00:00+08:00',
  ...p,
});
const now = Date.parse('2026-11-04T15:00:00-03:00'); // Wednesday 15:00 in Santiago

describe('eDo logic (legacy edo_logic.js)', () => {
  it('counts business hours in Santiago (Mon–Fri 9–18)', () => {
    const mon9 = Date.parse('2026-11-02T09:00:00-03:00');
    expect(businessHours(mon9, Date.parse('2026-11-02T18:00:00-03:00'), cfg)).toBe(9);
    expect(businessHours(mon9, Date.parse('2026-11-03T10:00:00-03:00'), cfg)).toBe(10);
    // Saturday and Sunday do not count.
    expect(
      businessHours(
        Date.parse('2026-11-07T09:00:00-03:00'),
        Date.parse('2026-11-09T09:00:00-03:00'),
        cfg,
      ),
    ).toBe(0);
  });

  it('knows who has the ball', () => {
    expect(edoBall(T({ firstOpr: null })).label).toBe('NO_FIRST_RESPONSE');
    expect(edoBall(T({ firstOpr: '2026-11-02T10:00:00+08:00' })).label).toBe('WHALE_WORKING');
    expect(edoBall(T({ side: 'WOM', org: 'WOM' }))).toEqual({ who: 'WOM', label: 'WAITING_WOM' });
    expect(edoBall(T({ status: 4 }))).toEqual({ who: 'WOM', label: 'WOM_VALIDATE' });
    expect(edoBall(T({ status: 5, open: false })).who).toBeNull();
  });

  it('uses eDo SLA limits when present, else the estimated targets', () => {
    expect(edoSlaState(T({ resSlaLimit: '2026-11-03T00:00:00+08:00' }), now, cfg)).toMatchObject({
      state: 'BREACHED',
      src: 'eDo',
    });
    expect(
      edoSlaState(
        T({ resSlaLimit: '2026-12-01T00:00:00+08:00', resSlaAlarm: '2026-11-01T00:00:00+08:00' }),
        now,
        cfg,
      ),
    ).toMatchObject({ state: 'AT_RISK', src: 'eDo' });
    // P2 without first response: 4 business-hour target, long gone.
    expect(edoSlaState(T({}), now, cfg)).toMatchObject({
      state: 'BREACHED',
      src: 'est',
      detail: 'response',
    });
    expect(edoSlaState(T({ status: 5, open: false }), now, cfg)).toBeNull();
  });

  it('flags stale tickets by priority and side', () => {
    const fresh = T({
      firstOpr: '2026-11-05T01:00:00+08:00',
      updated: '2026-11-05T01:00:00+08:00',
    });
    expect(edoStaleInfo(fresh, now, cfg).stale).toBe(false);
    expect(edoStaleInfo(T({ updated: '2026-10-20T10:00:00+08:00' }), now, cfg).stale).toBe(true);
  });

  it('builds KPIs, push groups and a copyable summary from the sample file', () => {
    const rows = (sample.incidents as Record<string, unknown>[]).map(edoRecordOf);
    const fixed = Date.parse(sample.generated_at);
    const en = edoEnrich(rows, fixed, cfg);
    const k = edoKpis(en, fixed);
    expect(k.open).toBe(sample.counts.open);
    expect(k.whale + k.wom).toBe(k.open);
    const groups = edoPushGroups(en);
    for (const g of groups) {
      expect(g.items.every((e) => e._open && e._ball.who === 'Whale')).toBe(true);
      expect(edoGroupSummary(g, cfg)).toContain(g.items[0]!.no);
    }
    expect(edoTrends(en, fixed, cfg)).toHaveLength(12);
  });

  it('keeps only the stored fields and trims the comment', () => {
    const r = edoRecordOf({ id: 'A', no: 'N', comment: 'x'.repeat(500), secret: 'no' });
    expect(r.comment).toHaveLength(300);
    expect('secret' in r).toBe(false);
  });
});
