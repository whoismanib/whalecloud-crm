import { describe, expect, it } from 'vitest';
import {
  canStartWork,
  daysToFirstOpportunity,
  edoTicketStats,
  exhaustionProjection,
  findRate,
  handoffChecklistMissing,
  handoffDueOn,
  handoffOnTime,
  onboardingOverdue,
  overdueQuarterlyReviews,
  poConsumption,
  previousQuarterStart,
  quarterStart,
  quoteCr,
  renewalAlert,
  renewalDates,
} from './postsales';
import {
  agreementFailures,
  COMPLIANCE_ITEMS,
  complianceFailures,
  detectChannelConflict,
  requiredComplianceSections,
} from './channel';
import {
  cadenceStep,
  categoryWarnings,
  forecastAccuracy,
  forecastTotals,
  isoWeek,
  previousFriday,
  quarterRange,
  weekOverWeekChanges,
  type ForecastItem,
} from './forecast';
import {
  mapLegacyTracker,
  legacyPoYear,
  legacyBaseName,
  matchLegacyInvoice,
  parseAmount,
  parseCsv,
  parseLooseDate,
  quarterEnd,
  neutralizeFormula,
  toCsv,
} from './importing';
import { CL_CALENDAR, toBusinessCalendar } from '../constants/holidays';
import { DEFAULT_SETTINGS } from '../schemas/settings';

const S = DEFAULT_SETTINGS;
const CL = toBusinessCalendar(CL_CALENDAR);

describe('P9 hand-off', () => {
  it('due 5 business days after signature: firma 2026-11-02 → 2026-11-09 (P9-01)', () => {
    expect(handoffDueOn('2026-11-02', CL, 5)).toBe('2026-11-09');
  });
  it('checklist and on-time start', () => {
    expect(handoffChecklistMissing({ sowReviewed: true, commercialSheetReviewed: true })).toEqual([
      'milestonesReviewed',
      'acceptanceCriteriaReviewed',
    ]);
    expect(
      handoffOnTime({
        dueOn: '2026-11-09',
        meetingOn: '2026-11-05',
        plannedStart: '2026-11-16',
        actualStart: '2026-11-16',
      }),
    ).toBe(true);
    expect(
      handoffOnTime({
        dueOn: '2026-11-09',
        meetingOn: '2026-11-10',
        plannedStart: '2026-11-16',
        actualStart: '2026-11-16',
      }),
    ).toBe(false);
    expect(
      handoffOnTime({ dueOn: null, meetingOn: null, plannedStart: null, actualStart: null }),
    ).toBeNull();
  });
});

describe('P10 renewals and reviews', () => {
  it('contract ending 2027-03-31 → create 2026-12-31 (T−90), quote by 2027-01-30 (T−60)', () => {
    expect(renewalDates('2027-03-31', S)).toEqual({
      createOn: '2026-12-31',
      quoteBy: '2027-01-30',
    });
  });
  it('alerts', () => {
    const r = {
      createOn: '2026-12-31',
      quoteBy: '2027-01-30',
      hasOpportunity: false,
      quoted: false,
      closed: false,
    };
    expect(renewalAlert(r, '2026-12-01')).toBe('NONE');
    expect(renewalAlert(r, '2026-12-31')).toBe('CREATE_OPPORTUNITY');
    expect(renewalAlert({ ...r, hasOpportunity: true }, '2027-01-10')).toBe('NONE');
    expect(renewalAlert({ ...r, hasOpportunity: true }, '2027-01-30')).toBe('QUOTE_OVERDUE');
    expect(renewalAlert({ ...r, quoted: true }, '2027-02-10')).toBe('NONE');
  });
  it('quarterly reviews overdue for key accounts (P10-02)', () => {
    expect(quarterStart('2026-11-04')).toBe('2026-10-01');
    expect(previousQuarterStart('2026-11-04')).toBe('2026-07-01');
    expect(previousQuarterStart('2026-02-10')).toBe('2025-10-01');
    expect(
      overdueQuarterlyReviews(
        ['a', 'b'],
        [{ accountId: 'a', kind: 'QUARTERLY', periodStart: '2026-07-01' }],
        '2026-11-04',
      ),
    ).toEqual([{ accountId: 'b', periodStart: '2026-07-01' }]);
  });
  it('eDo ticket stats', () => {
    expect(
      edoTicketStats(
        [
          { status: 'OPEN', priority: 'P1', slaDueOn: '2026-11-01', ballIn: 'WHALE' },
          { status: 'PENDING_CLIENT', priority: 'P2', slaDueOn: null, ballIn: 'CLIENT' },
          { status: 'CLOSED', priority: 'P1', slaDueOn: '2026-10-01', ballIn: 'WHALE' },
        ],
        '2026-11-04',
      ),
    ).toEqual({ open: 2, critical: 1, slaOverdue: 1, ballInWhale: 1, ballInClient: 1 });
  });
});

describe('P11 change requests', () => {
  const cards = [
    {
      id: 'r1',
      profile: 'Senior Developer',
      rate: '45',
      currency: 'USD',
      validFrom: '2026-01-01',
      validTo: null,
    },
    {
      id: 'r0',
      profile: 'Senior Developer',
      rate: '40',
      currency: 'USD',
      validFrom: '2025-01-01',
      validTo: '2025-12-31',
    },
    {
      id: 'r2',
      profile: 'PM',
      rate: '60',
      currency: 'USD',
      validFrom: '2026-01-01',
      validTo: null,
    },
  ];
  it('120 h × profile rate (P11-01)', () => {
    const q = quoteCr(
      [
        { profile: 'senior developer', hours: 120 },
        { profile: 'PM', hours: 10 },
      ],
      cards,
      '2026-11-04',
    );
    expect(q.lines[0]).toMatchObject({ rate: '45.00', amount: '5400.00', rateCardId: 'r1' });
    expect(q.total).toBe('6000.00');
    expect(q.currency).toBe('USD');
    expect(q.failures).toEqual([]);
    expect(findRate(cards, 'Senior Developer', '2025-06-01')?.id).toBe('r0');
  });
  it('missing rate card or lines', () => {
    expect(
      quoteCr([{ profile: 'Architect', hours: 5 }], cards, '2026-11-04').failures[0]!.code,
    ).toBe('RATE_CARD_MISSING');
    expect(quoteCr([], cards, '2026-11-04').failures[0]!.code).toBe('CR_LINES_REQUIRED');
    expect(
      quoteCr(
        [
          { profile: 'A', hours: 1 },
          { profile: 'B', hours: 1 },
        ],
        [
          { profile: 'A', rate: 1, currency: 'USD', validFrom: '2026-01-01', validTo: null },
          { profile: 'B', rate: 1, currency: 'CLP', validFrom: '2026-01-01', validTo: null },
        ],
        '2026-11-04',
      ).failures[0]!.code,
    ).toBe('RATE_CARD_CURRENCY_MIX');
  });
  it('no work without PO unless CM exception (P11-02)', () => {
    expect(
      canStartWork(
        { poReceivedOn: null, cmException: false, exceptionExpiresOn: null },
        '2026-11-04',
      ),
    ).toEqual([{ code: 'PO_REQUIRED' }]);
    expect(
      canStartWork(
        { poReceivedOn: null, cmException: true, exceptionExpiresOn: '2026-11-30' },
        '2026-11-04',
      ),
    ).toEqual([]);
    expect(
      canStartWork(
        { poReceivedOn: null, cmException: true, exceptionExpiresOn: '2026-11-01' },
        '2026-11-04',
      )[0]!.code,
    ).toBe('CR_EXCEPTION_EXPIRED');
    expect(
      canStartWork(
        { poReceivedOn: '2026-11-01', cmException: false, exceptionExpiresOn: null },
        '2026-11-04',
      ),
    ).toEqual([]);
  });
});

describe('P16 capacity', () => {
  it('PO 1000 h with 805 h → WARN_80; > 100 % → critical with excess (P16-02)', () => {
    expect(poConsumption(805, 1000, 0.8)).toEqual({
      pct: 0.805,
      alert: 'WARN_80',
      excessHours: '0.00',
      remainingHours: '195.00',
    });
    expect(poConsumption(1100, 1000, 0.8)).toMatchObject({
      alert: 'CRITICAL_100',
      excessHours: '100.00',
    });
    expect(poConsumption(500, 1000, 0.8).alert).toBe('NONE');
    expect(poConsumption(1, 0, 0.8).alert).toBe('CRITICAL_100');
  });
  it('projection at the average burn', () => {
    expect(exhaustionProjection([100, 200], 300)).toBe(2);
    expect(exhaustionProjection([], 300)).toBeNull();
    expect(exhaustionProjection([0], 300)).toBeNull();
  });
});

describe('P15 onboarding', () => {
  it('time to first opportunity and overdue checklist', () => {
    expect(daysToFirstOpportunity('2026-10-01', '2026-10-21')).toBe(20);
    expect(daysToFirstOpportunity('2026-10-01', null)).toBeNull();
    expect(
      onboardingOverdue(
        { startDate: '2026-10-01', pendingItems: 2, productiveAt: null },
        '2026-11-04',
        S,
      ),
    ).toBe(true);
    expect(
      onboardingOverdue(
        { startDate: '2026-10-20', pendingItems: 2, productiveAt: null },
        '2026-11-04',
        S,
      ),
    ).toBe(false);
    expect(
      onboardingOverdue(
        { startDate: '2026-10-01', pendingItems: 0, productiveAt: null },
        '2026-11-04',
        S,
      ),
    ).toBe(false);
  });
});

describe('P13 distributors', () => {
  const ag = {
    status: 'ACTIVE',
    startsOn: '2026-01-01',
    endsOn: '2026-12-31',
    territories: ['CL'],
    verticals: ['ROBOTICS'],
  };
  it('agreement in force, territory and vertical (P13-01)', () => {
    expect(
      agreementFailures([ag], { today: '2026-11-04', country: 'CL', vertical: 'ROBOTICS' }),
    ).toEqual([]);
    expect(agreementFailures([ag], { today: '2027-01-04', country: 'CL' })[0]!.code).toBe(
      'DISTRIBUTOR_AGREEMENT_EXPIRED',
    );
    expect(agreementFailures([ag], { today: '2026-11-04', country: 'PE' })[0]!.code).toBe(
      'DISTRIBUTOR_OUT_OF_TERRITORY',
    );
    expect(agreementFailures([], { today: '2026-11-04', country: 'CL' })[0]!.code).toBe(
      'DISTRIBUTOR_AGREEMENT_MISSING',
    );
  });
  it('channel conflict with a direct opportunity (P13-02)', () => {
    const r = detectChannelConflict(
      { distributorId: 'd1', accountId: 'a' },
      [
        { id: 'o1', accountId: 'a', distributorId: null, status: 'OPEN' },
        { id: 'o2', accountId: 'a', distributorId: 'd1', status: 'OPEN' },
        { id: 'o3', accountId: 'b', distributorId: null, status: 'OPEN' },
      ],
      [{ id: 'r9', accountId: 'a', distributorId: 'd2', status: 'APPROVED' }],
    );
    expect(r).toEqual({ conflict: true, opportunityIds: ['o1'], registrationIds: ['r9'] });
    expect(detectChannelConflict({ distributorId: 'd1', accountId: 'c' }, []).conflict).toBe(false);
  });
});

describe('P14 compliance', () => {
  it('export control mandatory for engine E or hardware (P14-01)', () => {
    expect(requiredComplianceSections('E', [])).toContain('EXPORT_CONTROL');
    expect(requiredComplianceSections('A', ['HARDWARE'])).toContain('EXPORT_CONTROL');
    expect(requiredComplianceSections('A', ['OWN_SOFTWARE'])).not.toContain('EXPORT_CONTROL');
    expect(COMPLIANCE_ITEMS.filter((i) => i.section === 'EXPORT_CONTROL').length).toBeGreaterThan(
      0,
    );
  });
  it('unanswered required items block submission', () => {
    const f = complianceFailures(
      [
        { section: 'DATA_PROTECTION', itemCode: 'DP_DPA_SIGNED', answer: null },
        { section: 'EXPORT_CONTROL', itemCode: 'EC_DUAL_USE_HW', answer: null },
        { section: 'ANTI_CORRUPTION', itemCode: 'AC_PUBLIC_OFFICIALS', answer: 'NO' },
      ],
      ['DATA_PROTECTION', 'ANTI_CORRUPTION', 'PUBLIC_TENDER'],
    );
    expect(f).toEqual([
      { code: 'COMPLIANCE_ITEMS_UNANSWERED', params: { items: ['DP_DPA_SIGNED'] } },
    ]);
    expect(complianceFailures([], ['DATA_PROTECTION'])).toEqual([]);
  });
});

describe('P12 forecast', () => {
  const it1 = (o: Partial<ForecastItem>): ForecastItem => ({
    opportunityId: 'x',
    stage: 4,
    status: 'OPEN',
    forecastCategory: 'PROBABLE',
    amount: '100',
    expectedCloseDate: '2026-12-01',
    ...o,
  });
  it('weeks, cadence and Friday', () => {
    expect(isoWeek('2026-11-04')).toEqual({ year: 2026, week: 45 });
    expect(isoWeek('2027-01-01')).toEqual({ year: 2026, week: 53 });
    expect(cadenceStep('2026-11-02')).toBe('UPDATE');
    expect(cadenceStep('2026-11-03')).toBe('REVIEW');
    expect(cadenceStep('2026-11-04')).toBe('REPORT');
    expect(cadenceStep('2026-11-06')).toBe('NONE');
    expect(previousFriday('2026-11-04')).toBe('2026-10-30');
    expect(previousFriday('2026-11-06')).toBe('2026-10-30');
  });
  it('category consistency (P12-01)', () => {
    expect(categoryWarnings(3, 'COMMIT', 4)).toEqual(['CATEGORY_INCONSISTENT']);
    expect(categoryWarnings(4, 'COMMIT', 4)).toEqual([]);
    expect(categoryWarnings(2, null, 4)).toEqual(['CATEGORY_REQUIRED']);
    expect(categoryWarnings(0, null, 4)).toEqual([]);
  });
  it('totals per category and weighted', () => {
    const t = forecastTotals(
      [
        it1({ opportunityId: 'a', forecastCategory: 'COMMIT', stage: 6 }),
        it1({ opportunityId: 'b' }),
        it1({ opportunityId: 'c', forecastCategory: 'PIPELINE', stage: 1 }),
        it1({ opportunityId: 'd', status: 'LOST' }),
        it1({ opportunityId: 'e', expectedCloseDate: '2027-02-01' }),
      ],
      S['forecast.stageProbabilities'],
      '2026-10-01',
      '2026-12-31',
    );
    expect(t).toEqual({
      commit: '100.00',
      probable: '100.00',
      pipeline: '100.00',
      weighted: '120.00',
      commitPlusProbable: '200.00',
    });
  });
  it('accuracy ±10 % (P12-05)', () => {
    expect(forecastAccuracy(95, 100)).toEqual({ deviation: -0.05, withinTolerance: true });
    expect(forecastAccuracy(120, 100)).toEqual({ deviation: 0.2, withinTolerance: false });
    expect(forecastAccuracy(1, 0).deviation).toBeNull();
  });
  it('week-over-week changes (P12-06)', () => {
    const prev = [
      it1({ opportunityId: 'a', stage: 3 }),
      it1({ opportunityId: 'b', stage: 5 }),
      it1({ opportunityId: 'c', stage: 6 }),
      it1({ opportunityId: 'd', stage: 4 }),
      it1({ opportunityId: 'e', stage: 2 }),
      it1({ opportunityId: 'z' }),
    ];
    const curr = [
      it1({ opportunityId: 'a', stage: 4 }),
      it1({ opportunityId: 'b', stage: 3 }),
      it1({ opportunityId: 'c', stage: 7 }),
      it1({ opportunityId: 'd', stage: 4, status: 'LOST' }),
      it1({ opportunityId: 'e', stage: 2, expectedCloseDate: '2027-01-15' }),
      it1({ opportunityId: 'n', stage: 1 }),
    ];
    prev.push(it1({ opportunityId: 'f', stage: 5, forecastCategory: 'PROBABLE' }));
    curr.push(it1({ opportunityId: 'f', stage: 5, forecastCategory: 'COMMIT' }));
    expect(weekOverWeekChanges(prev, curr).map((c) => `${c.opportunityId}:${c.change}`)).toEqual([
      'a:ADVANCED',
      'b:REGRESSED',
      'c:WON',
      'd:LOST',
      'e:SLIPPED',
      'n:NEW',
      'f:CATEGORY',
      'z:REMOVED',
    ]);
    expect(weekOverWeekChanges(prev, curr).find((c) => c.change === 'CATEGORY')).toMatchObject({
      from: 'PROBABLE',
      to: 'COMMIT',
    });
  });
  it('quarter ranges', () => {
    expect(quarterRange('2026Q4')).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(quarterRange('2026Q1').to).toBe('2026-03-31');
    expect(() => quarterRange('2026-4')).toThrow();
  });
});

describe('import / export helpers', () => {
  it('parses CSV with quotes, ; delimiter and BOM', () => {
    expect(parseCsv('\uFEFFname;amount\n"WOM; S.A.";1.000,50\r\n\nGTD;"2"\n')).toEqual([
      { name: 'WOM; S.A.', amount: '1.000,50' },
      { name: 'GTD', amount: '2' },
    ]);
    expect(parseCsv('a,b\n"x ""y""",2')).toEqual([{ a: 'x "y"', b: '2' }]);
    expect(parseCsv('')).toEqual([]);
  });
  it('writes CSV', () => {
    expect(toCsv([{ a: 'x,y', b: 1, c: null }], ['a', 'b', 'c'])).toBe(
      '\uFEFFa,b,c\r\n"x,y",1,\r\n',
    );
    expect(toCsv([{ a: { k: 1 } }], ['a'])).toContain('"{""k"":1}"');
  });
  it('neutralizes spreadsheet formulas in exports (QA-006, CWE-1236)', () => {
    const csv = toCsv(
      [
        { v: '=HYPERLINK("http://evil.example","x")' },
        { v: '+1+2' },
        { v: '-2+3' },
        { v: '@SUM(A1)' },
        { v: '\tcmd' },
        { v: '\rcmd' },
        { v: '-12.50' },
        { v: -5 },
        { v: 'WOM' },
      ],
      ['v'],
    );
    const lines = csv.slice(1).split('\r\n');
    expect(lines.slice(1, 10)).toEqual([
      `"'=HYPERLINK(""http://evil.example"",""x"")"`,
      "'+1+2",
      "'-2+3",
      "'@SUM(A1)",
      `"'\tcmd"`,
      `"'\rcmd"`,
      '-12.50',
      '-5',
      'WOM',
    ]);
    expect(neutralizeFormula('=1')).toBe("'=1");
    expect(neutralizeFormula(7)).toBe(7);
  });
  it('loose dates, quarters and amounts', () => {
    expect(parseLooseDate('2026-11-04T10:00')).toBe('2026-11-04');
    expect(parseLooseDate('4/11/2026')).toBe('2026-11-04');
    expect(parseLooseDate('nope')).toBeNull();
    expect(parseLooseDate(null)).toBeNull();
    expect(quarterEnd('Q3 2026')).toBe('2026-09-30');
    expect(quarterEnd('2026Q4')).toBe('2026-12-31');
    expect(quarterEnd('soon')).toBeNull();
    expect(parseAmount('US$ 1.234.567,50')).toBe('1234567.50');
    expect(parseAmount('1,234,567.5')).toBe('1234567.50');
    expect(parseAmount(42)).toBe('42.00');
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('')).toBeNull();
  });
  it('maps the legacy tracker JSON with the legacy status mapping', () => {
    const r = mapLegacyTracker(
      {
        wom: [
          {
            status: 'PO',
            po: '4500123',
            name: 'CR Portabilidad',
            delivery: '2026-06-30',
            expected: 120000,
            po_net: 118000,
            risk: 'Low',
            pic: 'Manuel',
          },
          { status: 'TP Sent', name: 'V9 Upgrade', expected: '1.850.000', risk: 'Medium' },
          { status: 'Cancelled', name: 'Data lake', expected: 50000 },
          { status: 'PVB', name: '' },
        ],
        new_clients: [
          {
            status: 'Preparing RFP',
            client: 'Entel',
            name: 'RFI OSS',
            expected: 900000,
            quarter: 'Q1 2027',
            competition: 'Huawei',
          },
          { status: 'lost', client: 'GTD', name: 'LPC', expected: 1 },
          { client: 'Coopeuch', name: 'Billetera' },
        ],
        billing: [
          {
            name: 'CR Portabilidad',
            reception: '2026-07-01',
            usd: 118000,
            invoice_no: 'F-1',
            invoice_date: '2026-07-05',
            due: '2026-08-19',
            status: 'Paid',
          },
          { name: 'V9 Upgrade', usd: 0 },
          { name: 'Soporte', usd: 10, status: 'Pending' },
        ],
      },
      { importDate: '2026-11-04' },
    );
    expect(r.opportunities.map((o) => [o.name, o.stage, o.status, o.legacyStatus])).toEqual([
      ['CR Portabilidad', 7, 'OPEN', 'PO'],
      ['V9 Upgrade', 5, 'OPEN', 'TP Sent'],
      ['Data lake', 3, 'LOST', 'Cancelled'],
      ['RFI OSS', 3, 'OPEN', 'Preparing RFP'],
      ['LPC', 1, 'LOST', 'lost'],
      ['Billetera', 1, 'OPEN', null],
    ]);
    expect(r.opportunities[0]).toMatchObject({
      billingEngine: 'B',
      amountUsd: '120000.00',
      poAmountUsd: '118000.00',
      poNumber: '4500123',
      risk: 'LOW',
    });
    expect(r.opportunities[1]).toMatchObject({
      amountUsd: '1850000.00',
      expectedCloseDate: '2026-12-31',
    });
    expect(r.opportunities[3]).toMatchObject({
      customerType: 'NEW',
      expectedCloseDate: '2027-03-31',
      competitor: 'Huawei',
    });
    expect(r.invoices.map((i) => [i.projectName, i.payStatus])).toEqual([
      ['CR Portabilidad', 'PAID'],
      ['Soporte', 'PENDING'],
    ]);
    expect(r.failures.map((f) => `${f.source}:${f.row}`)).toEqual(['wom:4', 'billing:2']);
  });

  it('assigns PO years like the legacy app (sales_tracker.py po_year)', () => {
    const y = (r: Record<string, unknown>) => legacyPoYear(r, 2026);
    expect(y({ status: 'PO', po: '71995', po_date: '2025-07-18', delivery: 'Q3 2026' })).toBe(2025);
    expect(y({ status: 'PO', po: '71247', delivery: 'Q2, Q3, Q4 2025' })).toBe(2025);
    expect(y({ status: 'PO', po: '', delivery: '2027' })).toBe(2027);
    expect(y({ status: 'PO', po: '72645', delivery: '2025' })).toBe(2025);
    expect(y({ status: 'Voucher', delivery: 'Q1' })).toBe(2026);
    expect(y({ status: 'TP Sent', delivery: 'Q4' })).toBe(2027);
    const r = mapLegacyTracker(
      {
        wom: [
          {
            status: 'PO',
            po: '74892',
            po_date: '2026-03-18',
            name: 'BSS Support L3',
            delivery: '2026',
            expected: 543608,
          },
          { status: 'PO', po: '', name: 'BSS Support L3', delivery: '2027', expected: 543608 },
          {
            status: 'PO',
            po: '72645',
            name: 'Portabilidad CAP',
            delivery: '2025',
            expected: 105000,
            po_net: 88850,
          },
        ],
      },
      { importDate: '2026-11-04' },
    );
    expect(
      r.opportunities.map((o) => [o.poYear, o.wonOn, o.expectedCloseDate, o.amountUsd]),
    ).toEqual([
      [2026, '2026-03-18', '2026-12-31', '543608.00'],
      [2027, '2027-01-01', '2027-12-31', '543608.00'],
      [2025, '2025-12-31', '2025-12-31', '105000.00'],
    ]);
  });

  it('matches legacy billing rows to projects (quarters, variants, same name across years)', () => {
    const c = [
      { name: 'BSS Support L3', year: 2026 },
      { name: 'BSS Support L3', year: 2027 },
      { name: 'BSS Support L3 (Q2-Q4 2025)', year: 2025 },
      { name: 'Regulatory Register User', year: 2025 },
      { name: 'Regulatory Register User Phase 2 - Phase 1', year: 2026 },
      { name: 'Migrate Prepaid OCS', year: 2026 },
      { name: 'Multiple APN configuration for B2B', year: 2026 },
    ];
    const m = (n: string, y: number | null) => matchLegacyInvoice(n, y, c);
    expect(legacyBaseName('BSS Support L3 Q3 2025')).toBe('bss support l3');
    expect(m('BSS Support L3 Q1', 2026)).toBe(c[0]);
    expect(m('BSS Support L3 Q4', 2027)).toBe(c[1]);
    expect(m('BSS Support L3 Q3 2025', 2025)).toBe(c[2]);
    expect(m('Regulatory Register User Phase 2 - Phase 1', 2026)).toBe(c[4]);
    expect(m('Regulatory Register User', 2026)).toBe(c[3]);
    expect(m('Migrate Prepaid OCS, Greenplum, Mediation', 2026)).toBe(c[5]);
    expect(m('Multiple APN', 2026)).toBe(c[6]);
    expect(m('National Roaming Control', 2026)).toBeNull();
  });
});
