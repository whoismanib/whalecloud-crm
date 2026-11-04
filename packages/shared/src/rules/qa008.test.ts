import { describe, expect, it } from 'vitest';
import {
  delegatedAuthority,
  delegationActive,
  delegationFailures,
  type Delegation,
} from './delegation';

const d = (o: Partial<Delegation> = {}): Delegation => ({
  delegatorUserId: 'alex',
  delegateUserId: 'jacky',
  role: 'LATAM_PRESIDENT',
  startsOn: '2026-11-04',
  endsOn: '2026-11-15',
  ...o,
});

describe('ADM-04 approval delegation (QA-008)', () => {
  it('active only within dates and while not revoked', () => {
    expect(delegationActive(d(), '2026-11-03')).toBe(false);
    expect(delegationActive(d(), '2026-11-04')).toBe(true);
    expect(delegationActive(d(), '2026-11-15')).toBe(true);
    expect(delegationActive(d(), '2026-11-16')).toBe(false);
    expect(delegationActive(d({ revokedAt: '2026-11-05T10:00:00Z' }), '2026-11-06')).toBe(false);
  });
  it('validation: role held, no self-delegation, valid range not in the past', () => {
    expect(delegationFailures(d(), ['LATAM_PRESIDENT'], '2026-11-04')).toEqual([]);
    expect(
      delegationFailures(
        d({ delegateUserId: 'alex', endsOn: '2026-11-01' }),
        ['VP'],
        '2026-11-04',
      ).map((f) => f.code),
    ).toEqual(['DELEGATION_SELF', 'DELEGATION_ROLE_NOT_HELD', 'DATE_RANGE_INVALID']);
    expect(
      delegationFailures(
        d({ startsOn: '2026-10-01', endsOn: '2026-10-31' }),
        ['LATAM_PRESIDENT'],
        '2026-11-04',
      ).map((f) => f.code),
    ).toEqual(['DELEGATION_IN_PAST']);
  });
  it('authority of the delegate today', () => {
    const list = [
      d(),
      d({ role: 'VP', delegatorUserId: 'v', endsOn: '2026-11-04' }),
      d({ delegateUserId: 'x' }),
    ];
    expect(delegatedAuthority(list, 'jacky', '2026-11-04')).toEqual({
      roles: ['LATAM_PRESIDENT', 'VP'],
      onBehalfOf: [
        { userId: 'alex', role: 'LATAM_PRESIDENT' },
        { userId: 'v', role: 'VP' },
      ],
    });
    expect(delegatedAuthority(list, 'jacky', '2026-11-05').roles).toEqual(['LATAM_PRESIDENT']);
    expect(delegatedAuthority(list, 'nobody', '2026-11-05')).toEqual({ roles: [], onBehalfOf: [] });
  });
});

describe('DASH-05 process KPI helpers (QA-008)', () => {
  it('traffic light by direction', async () => {
    const { processKpiRag, share } = await import('./processKpis');
    const { median } = await import('./kpis');
    expect(processKpiRag(1, 1, 'MIN')).toBe('GREEN');
    expect(processKpiRag(0.9, 1, 'MIN')).toBe('AMBER');
    expect(processKpiRag(0.5, 1, 'MIN')).toBe('RED');
    expect(processKpiRag(30, 30, 'MAX')).toBe('GREEN');
    expect(processKpiRag(34, 30, 'MAX')).toBe('AMBER');
    expect(processKpiRag(40, 30, 'MAX')).toBe('RED');
    expect(processKpiRag(0, 0, 'ZERO')).toBe('GREEN');
    expect(processKpiRag(2, 0, 'ZERO')).toBe('RED');
    expect(processKpiRag(-0.08, 0.1, 'BAND')).toBe('GREEN');
    expect(processKpiRag(-0.2, 0.1, 'BAND')).toBe('RED');
    expect(processKpiRag(null, 1, 'MIN')).toBe('NONE');
    expect(processKpiRag(5, null, 'MIN')).toBe('NONE');
    expect(processKpiRag(5, null, 'NONE')).toBe('NONE');
    expect(share(1, 3)).toBe(0.3333);
    expect(share(1, 0)).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});
