import { describe, expect, it } from 'vitest';
import { agingBucket, dueEscalations, escalationSchedule, escalationStatus } from './collections';
import {
  canAccept,
  canSendToFinance,
  missingEvidence,
  requiredEvidence,
  signatureFailures,
} from './evidence';
import {
  compareCashflowVsTc,
  deriveStageFromMilestones,
  milestonesFailures,
  recognitionDate,
  sumsTo100,
} from './milestones';
import { DEFAULT_SETTINGS } from '../schemas/settings';

const S = DEFAULT_SETTINGS;

describe('collections escalation (P8-06)', () => {
  it('schedule −10/+1/+7/+15/+30 in calendar days with responsibles', () => {
    const s = escalationSchedule('2026-11-30', S);
    expect(s.map((e) => [e.step, e.scheduledOn])).toEqual([
      ['D_MINUS_10', '2026-11-20'],
      ['D_PLUS_1', '2026-12-01'],
      ['D_PLUS_7', '2026-12-07'],
      ['D_PLUS_15', '2026-12-15'],
      ['D_PLUS_30', '2026-12-30'],
    ]);
    expect(s[0]!.responsibleRoles).toEqual(['ACCOUNT_MANAGER']);
    expect(s[4]!.responsibleRoles).toEqual(['CHINA_FINANCE', 'CHINA_LEGAL']);
  });

  it('due 2026-11-30 unpaid → on 2026-12-15 the +15 task goes to the CM and notifies the LatAm president', () => {
    const st = escalationStatus({ dueOn: '2026-11-30', balance: '1000' }, '2026-12-15', S);
    expect(st.currentStep).toBe('D_PLUS_15');
    expect(st.responsibleRoles).toEqual(['COUNTRY_MANAGER']);
    expect(st.notifyRoles).toContain('LATAM_PRESIDENT');
    expect(st.daysOverdue).toBe(15);
    expect(st.bucket).toBe('8-15');
    expect(st.nextStep).toBe('D_PLUS_30');
    expect(st.nextOn).toBe('2026-12-30');
    const due = dueEscalations(
      { dueOn: '2026-11-30', balance: '1000' },
      '2026-12-15',
      ['D_MINUS_10', 'D_PLUS_1', 'D_PLUS_7'],
      S,
    );
    expect(due.map((d) => d.step)).toEqual(['D_PLUS_15']);
  });

  it('a paid invoice creates no tasks', () => {
    expect(dueEscalations({ dueOn: '2026-11-30', balance: '0' }, '2026-12-15', [], S)).toEqual([]);
    const st = escalationStatus({ dueOn: '2026-11-30', balance: 0 }, '2026-12-15', S);
    expect(st).toMatchObject({ paid: true, currentStep: null, nextStep: null, daysOverdue: 0 });
  });

  it('before D−10 there is no current step', () => {
    const st = escalationStatus({ dueOn: '2026-11-30', balance: 10 }, '2026-11-01', S);
    expect(st.currentStep).toBeNull();
    expect(st.nextStep).toBe('D_MINUS_10');
    expect(st.bucket).toBe('CURRENT');
  });

  it.each([
    [0, 'CURRENT'],
    [1, '1-7'],
    [7, '1-7'],
    [8, '8-15'],
    [16, '16-30'],
    [30, '16-30'],
    [31, '30+'],
  ] as const)('aging bucket for %s days → %s', (d, b) => expect(agingBucket(d)).toBe(b));
});

describe('milestones (P5-02, P7-02, CORE-06)', () => {
  it('payment milestones must add to 100 %', () => {
    expect(sumsTo100([{ pct: 30 }, { pct: 50 }, { pct: 20 }])).toBe(true);
    expect(sumsTo100([{ pct: '33.33' }, { pct: '33.33' }, { pct: '33.33' }])).toBe(false);
    expect(sumsTo100([])).toBe(false);
    expect(milestonesFailures([{ pct: 30 }, { pct: 50 }])).toEqual([
      { code: 'MILESTONES_NOT_100', params: { total: '80.00' } },
    ]);
    expect(milestonesFailures([{ pct: 100 }])).toEqual([]);
  });

  it('cash flow 20/20/50/10 vs T&C 30/50/20 → differences visible', () => {
    const cf = [20, 20, 50, 10].map((pct, i) => ({ seq: i + 1, pct, trigger: 'OTHER' as const }));
    const tc = [30, 50, 20].map((pct, i) => ({ seq: i + 1, pct, trigger: 'OTHER' as const }));
    const r = compareCashflowVsTc(cf, tc);
    expect(r.equal).toBe(false);
    expect(r.diffs).toEqual([
      { seq: 1, field: 'pct', cashflow: '20.00', tc: '30.00' },
      { seq: 2, field: 'pct', cashflow: '20.00', tc: '50.00' },
      { seq: 3, field: 'pct', cashflow: '50.00', tc: '20.00' },
      { seq: 4, field: 'missing_in_tc', cashflow: '10.00', tc: null },
    ]);
    const r2 = compareCashflowVsTc(tc, cf);
    expect(r2.diffs.at(-1)).toEqual({
      seq: 4,
      field: 'missing_in_cashflow',
      cashflow: null,
      tc: '10.00',
    });
  });

  it('same % with different trigger is a mismatch', () => {
    const r = compareCashflowVsTc(
      [{ seq: 1, pct: 100, trigger: 'UAT' }],
      [{ seq: 1, pct: '100.00', trigger: 'GO_LIVE' }],
    );
    expect(r.diffs).toEqual([{ seq: 1, field: 'trigger', cashflow: 'UAT', tc: 'GO_LIVE' }]);
    expect(
      compareCashflowVsTc(
        [{ seq: 1, pct: 100, trigger: 'UAT' }],
        [{ seq: 1, pct: 100, trigger: 'UAT' }],
      ).equal,
    ).toBe(true);
  });

  it('derived stage = minimum milestone state: 1 collected + 2 accepted → 9', () => {
    expect(deriveStageFromMilestones(['PAID', 'ACCEPTED', 'ACCEPTED'])).toBe(9);
    expect(deriveStageFromMilestones(['PAID', 'PAID'])).toBe(11);
    expect(deriveStageFromMilestones(['PAID', 'PARTIALLY_PAID'])).toBe(10);
    expect(deriveStageFromMilestones(['INVOICED', 'SENT_TO_FINANCE'])).toBe(9);
    expect(deriveStageFromMilestones(['PAID', 'READY'])).toBe(8);
    expect(deriveStageFromMilestones(['CANCELLED'])).toBe(8);
    expect(deriveStageFromMilestones(['PAID', 'CANCELLED'])).toBe(11);
  });

  it('recognition date = max(AC, reception)', () => {
    expect(recognitionDate('2026-10-01', '2026-10-05')).toBe('2026-10-05');
    expect(recognitionDate('2026-10-09', '2026-10-05')).toBe('2026-10-09');
    expect(recognitionDate(null, '2026-10-05')).toBeNull();
  });
});

describe('evidence by billing engine (P8-02/P8-03)', () => {
  const acct = { acceptsSimpleEsign: false };
  it('engine A requires acceptance email + MSA + signed AC + reception', () => {
    expect(requiredEvidence('A')).toEqual(['ACCEPTANCE_EMAIL', 'MSA', 'SIGNED_AC', 'RECEPTION']);
    expect(missingEvidence('A', [{ evidenceType: 'RECEPTION' }])).toEqual([
      'ACCEPTANCE_EMAIL',
      'MSA',
      'SIGNED_AC',
    ]);
  });
  it('engine B without PO is blocked; D without usage report is blocked', () => {
    expect(canAccept('B', [{ evidenceType: 'RECEPTION' }], acct)[0]).toMatchObject({
      code: 'EVIDENCE_MISSING',
      params: { types: ['PO'] },
    });
    expect(canAccept('D', [{ evidenceType: 'PERIOD_ELAPSED' }], acct)[0]!.params).toMatchObject({
      types: ['USAGE_REPORT'],
    });
    expect(requiredEvidence('C')).toEqual(['TERM_START']);
    expect(requiredEvidence('E')).toEqual(['DELIVERY_NOTE']);
    expect(requiredEvidence('E', { rental: true })).toEqual(['PERIOD_ELAPSED']);
  });
  it('simple e-signature rejected when the account does not accept it (PRD Q7)', () => {
    const ac = { evidenceType: 'SIGNED_AC' as const, signatureType: 'SIMPLE_ESIGN' as const };
    expect(signatureFailures(ac, acct)).toEqual([
      { code: 'SIMPLE_ESIGN_NOT_ACCEPTED', params: { evidenceType: 'SIGNED_AC' } },
    ]);
    expect(signatureFailures(ac, { acceptsSimpleEsign: true })).toEqual([]);
    expect(signatureFailures({ evidenceType: 'MSA', signatureType: 'SIMPLE_ESIGN' }, acct)).toEqual(
      [],
    );
  });
  it('send to finance requires an accepted milestone', () => {
    const ev = [{ evidenceType: 'PO' as const }, { evidenceType: 'RECEPTION' as const }];
    expect(canSendToFinance({ status: 'READY', billingEngine: 'B' }, ev, acct)[0]!.code).toBe(
      'MILESTONE_NOT_ACCEPTED',
    );
    expect(canSendToFinance({ status: 'ACCEPTED', billingEngine: 'B' }, ev, acct)).toEqual([]);
  });
});
