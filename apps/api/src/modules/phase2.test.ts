import type { FastifyInstance } from 'fastify';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, client, createTestApp, login, uniq } from '../../test/helpers';
import {
  approveCompliance,
  createOpportunity,
  HANDOFF_CHECKLIST_OK,
  lineAt,
  loadSheet,
  okData,
  qualifyTo,
  submitPriceRequest,
  type ApiClient,
  type OppSetup,
} from '../db/seed/flows';

let app: FastifyInstance;
type C = ReturnType<typeof client>;
let am: C;
let cm: C;
let china: C;
let legal: C;
let admin: C;
let entityId: string;
let ids: Record<string, string> = {};

const codes = (r: { body: { errors?: { code: string }[] } }) =>
  (r.body.errors ?? []).map((e) => e.code);

async function newAccount(c: ApiClient, extra: object = {}) {
  return okData(
    c.post('/accounts', {
      name: uniq('Cuenta '),
      countryCode: 'CL',
      vertical: 'TELECOM_BSS',
      customerType: 'EXISTING',
      defaultBillingEntityId: entityId,
      currency: 'USD',
      ...extra,
    }),
  );
}

/** Opportunity taken through P1–P7 (won, contract signed on `signedOn`). */
async function wonOpportunity(
  signedOn = '2026-11-02',
  engine: 'A' | 'C' = 'A',
): Promise<OppSetup & { contractId: string }> {
  const acc = await newAccount(am);
  const s = await createOpportunity(am, {
    accountId: acc.id,
    name: uniq('Ganada '),
    vertical: 'TELECOM_BSS',
    engine,
    amount: '300000',
    close: '2026-12-15',
    firstContact: '2026-11-02',
    contact: { firstName: 'Eva', lastName: 'Ruiz', jobTitle: 'CFO', roles: ['ECONOMIC_BUYER'] },
  });
  await qualifyTo(am, s, 3);
  const pr = await submitPriceRequest(am, s, { targetPrice: '300000' });
  const sheet = await loadSheet(china, pr, { lineItems: [lineAt(1, 'OWN_SOFTWARE', 300000, 0.7)] });
  const ar = await okData(am.post(`/sheet-versions/${sheet.id}/approval-requests`, {}));
  const [step] = (await okData(am.get(`/approval-requests/${ar.id}`))).steps;
  await okData(china.post(`/approval-steps/${step.id}/decision`, { decision: 'APPROVED' }));
  await approveCompliance(am, legal, cm, s.oppId);
  await okData(am.post(`/opportunities/${s.oppId}/transitions`, { toStage: 6 }));
  const k = await okData(
    am.post('/contracts', {
      accountId: s.accountId,
      opportunityId: s.oppId,
      type: engine === 'C' ? 'SOW' : 'OC',
      number: uniq('N'),
      title: 'Contrato',
      billingEntityId: entityId,
      billingEngine: engine,
      amount: '300000',
      currency: 'USD',
      startDate: signedOn,
      endDate: engine === 'C' ? '2027-01-15' : null,
      renewable: engine === 'C',
    }),
  );
  await okData(
    am.post(`/contracts/${k.id}/sign`, {
      signedOn,
      repositoryUrl: 'https://repo.example.com/x',
      standardName: `CL_CLIENTE_OC_${k.number}_v1_${signedOn}.pdf`,
      chinaSystemId: uniq('CN-'),
    }),
  );
  await okData(am.post(`/opportunities/${s.oppId}/transitions`, { toStage: 7 }));
  return { ...s, contractId: k.id };
}

beforeAll(async () => {
  app = await createTestApp();
  const amS = await as(app, ['ACCOUNT_MANAGER']);
  const cmS = await as(app, ['COUNTRY_MANAGER']);
  am = client(app, amS);
  cm = client(app, cmS);
  china = client(app, await as(app, ['CHINA_SALES'], { countryCodes: ['*'] }));
  legal = client(app, await as(app, ['CHINA_LEGAL'], { countryCodes: ['*'] }));
  admin = client(app, await as(app, ['ADMIN'], { countryCodes: ['*'] }));
  ids = {
    am: amS.userId,
    cm: cmS.userId,
    ld: (await as(app, ['LOCAL_DELIVERY'])).userId,
    cd: (await as(app, ['CHINA_DELIVERY'])).userId,
  };
  entityId = (await okData(am.get('/catalogs'))).billingEntities.find(
    (b: { code: string }) => b.code === 'WC_CL_SPA',
  ).id;
});
afterAll(async () => {
  await app.close();
});

describe('P9 hand-off', () => {
  it('SLA 5 business days from signature, checklist required for stage 8 (P9-01/02)', async () => {
    const s = await wonOpportunity('2026-11-02');
    await okData(
      am.post(`/opportunities/${s.oppId}/handoff`, {
        meetingAt: '2026-11-05',
        attendeeUserIds: [ids.ld, ids.cd],
        zmpProjectId: 'ZMP-1',
        sowReviewed: true,
      }),
    );
    expect(codes(await am.post(`/opportunities/${s.oppId}/transitions`, { toStage: 8 }))).toEqual([
      'HANDOFF_CHECKLIST_INCOMPLETE',
    ]);
    const list = await okData(am.get('/handoffs'));
    const h = list.find((x: { opportunityId: string }) => x.opportunityId === s.oppId);
    expect(h).toMatchObject({ dueOn: '2026-11-09', meetingLate: false });
    expect(h.checklistMissing).toEqual([
      'commercialSheetReviewed',
      'milestonesReviewed',
      'acceptanceCriteriaReviewed',
    ]);
    await okData(
      am.patch(`/handoffs/${h.id}`, {
        ...HANDOFF_CHECKLIST_OK,
        plannedStart: '2026-11-16',
        actualStart: '2026-11-16',
      }),
    );
    await okData(am.post(`/opportunities/${s.oppId}/transitions`, { toStage: 8 }));
    const after = (await okData(am.get('/handoffs'))).find((x: { id: string }) => x.id === h.id);
    expect(after.onTime).toBe(true);
  });
});

describe('P10 accounts and renewals', () => {
  it('account plan approved by the CM; quarterly + monthly eDo reviews; overdue list', async () => {
    const acc = await newAccount(am, { isKeyAccount: true });
    const plan = await okData(
      am.post(`/accounts/${acc.id}/plans`, {
        year: 2026,
        objectives: 'Crecer 20 %',
        target: '5000000',
        targetCurrency: 'USD',
      }),
    );
    expect((await am.post(`/account-plans/${plan.id}/approve`)).status).toBe(403);
    expect((await okData(cm.post(`/account-plans/${plan.id}/approve`))).status).toBe('APPROVED');
    const overdue = await okData(am.get('/reviews/overdue'));
    expect(overdue.find((o: { accountId: string }) => o.accountId === acc.id)).toMatchObject({
      periodStart: '2026-07-01',
    });
    await okData(
      am.post(`/accounts/${acc.id}/reviews`, {
        kind: 'QUARTERLY',
        periodStart: '2026-07-01',
        heldOn: '2026-10-10',
        findings: 'OK',
      }),
    );
    expect(
      (await okData(am.get('/reviews/overdue'))).find(
        (o: { accountId: string }) => o.accountId === acc.id,
      ),
    ).toBeUndefined();
    await okData(
      cm.post('/tickets', {
        accountId: acc.id,
        number: uniq('E'),
        title: 'x',
        priority: 'P1',
        openedOn: '2026-10-01',
        slaDueOn: '2026-10-02',
      }),
    );
    const edo = await okData(
      am.post(`/accounts/${acc.id}/reviews`, {
        kind: 'EDO_MONTHLY',
        periodStart: '2026-10-01',
        heldOn: '2026-11-03',
        findings: 'P1 abierto',
      }),
    );
    expect(edo.edoTicketStats).toMatchObject({ open: 1, critical: 1, slaOverdue: 1 });
  });

  it('renewal calendar T−90/T−60; job creates the renewal opportunity and alerts (P10-03/04)', async () => {
    const s = await wonOpportunity('2026-11-02', 'C');
    const ren = (await okData(am.get('/renewals'))).find(
      (r: { contractId: string }) => r.contractId === s.contractId,
    );
    expect(ren).toMatchObject({
      endDate: '2027-01-15',
      createOn: '2026-10-17',
      quoteBy: '2026-11-16',
      alert: 'CREATE_OPPORTUNITY',
    });
    const run = await okData(
      client(app, await as(app, ['ADMIN'], { countryCodes: ['*'] }), '2026-11-20').post(
        '/admin/jobs/renewals.daily/run',
      ),
    );
    expect(run.result.opportunities).toBeGreaterThanOrEqual(1);
    const after = (await okData(am.get('/renewals'))).find((r: { id: string }) => r.id === ren.id);
    expect(after.renewalOpportunityId).toBeTruthy();
    const opp = await okData(am.get(`/opportunities/${after.renewalOpportunityId}`));
    expect(opp).toMatchObject({ isRenewal: true, stage: 0, expectedCloseDate: '2027-01-15' });
    const notes = await request(app.server)
      .get('/api/v1/notifications')
      .set(
        'Cookie',
        (
          await login(
            app,
            (await app.ctx.pool.query(`SELECT email FROM users WHERE id=$1`, [ids.am])).rows[0]
              .email,
          )
        ).cookie,
      );
    expect(notes.body.data.map((n: { titleKey: string }) => n.titleKey)).toEqual(
      expect.arrayContaining(['renewalCreated', 'renewalQuoteOverdue']),
    );
  });
});

describe('P11 change requests', () => {
  it('rate card quote, PO required unless CM exception, PO → won opportunity, reception → milestone', async () => {
    const s = await wonOpportunity();
    await okData(
      am.post('/rate-cards', {
        contractId: s.contractId,
        profile: 'Senior Developer',
        rate: '45',
        currency: 'USD',
        validFrom: '2026-01-01',
      }),
    );
    const cr = await okData(
      am.post('/change-requests', { parentContractId: s.contractId, title: 'Nuevo reporte' }),
    );
    expect(cr.code).toMatch(/^CR-2026-\d{4}$/);
    expect(
      codes(
        await am.put(`/change-requests/${cr.id}/lines`, [{ profile: 'Arquitecto', hours: 10 }]),
      ),
    ).toEqual(['RATE_CARD_MISSING']);
    const q = await okData(
      am.put(`/change-requests/${cr.id}/lines`, [{ profile: 'Senior Developer', hours: 120 }]),
    );
    expect(q).toMatchObject({ status: 'QUOTED', amount: '5400.00', amountCurrency: 'USD' });
    expect(codes(await am.post(`/change-requests/${cr.id}/start-work`))).toEqual(['PO_REQUIRED']);
    expect(
      (
        await am.post(`/change-requests/${cr.id}/exception`, {
          reason: 'Urgente',
          expiresOn: '2026-11-30',
        })
      ).status,
    ).toBe(403);
    await okData(
      cm.post(`/change-requests/${cr.id}/exception`, {
        reason: 'Urgencia operacional',
        expiresOn: '2026-11-30',
      }),
    );
    expect((await okData(am.post(`/change-requests/${cr.id}/start-work`))).status).toBe(
      'IN_PROGRESS',
    );
    const ex = await app.ctx.pool.query(
      `SELECT count(*)::int n FROM audit_log WHERE entity_id=$1 AND category='EXCEPTION'`,
      [cr.id],
    );
    expect(ex.rows[0].n).toBe(2);
    expect(
      (await okData(cm.get('/reports/work-without-po'))).some(
        (x: { id: string }) => x.id === cr.id,
      ),
    ).toBe(true);
    const po = await okData(
      am.post(`/change-requests/${cr.id}/po`, {
        poNumber: '4500999',
        poReceivedOn: '2026-11-05',
        url: 'https://repo.example.com/oc',
        standardName: 'CL_CLIENTE_OC_4500999_v1_2026-11-05.pdf',
      }),
    );
    const opp = await okData(am.get(`/opportunities/${po.opportunityId}`));
    expect(opp).toMatchObject({ stage: 7, billingEngine: 'B', amount: '5400.00' });
    const rec = await okData(
      am.post(`/change-requests/${cr.id}/reception`, {
        receptionOn: '2026-11-20',
        url: 'https://repo.example.com/rec',
        standardName: 'CL_CLIENTE_REC_4500999_v1_2026-11-20.pdf',
      }),
    );
    const ms = await okData(am.get(`/milestones?opportunityId=${po.opportunityId}`));
    expect(ms[0]).toMatchObject({
      id: rec.milestoneId,
      status: 'ACCEPTED',
      recognizedOn: '2026-11-20',
    });
    expect(ms[0].evidence.map((e: { evidenceType: string }) => e.evidenceType).sort()).toEqual([
      'PO',
      'RECEPTION',
    ]);
  });
});

describe('P12 forecast', () => {
  it('category warning, weekly immutable snapshot, changes, accuracy and report', async () => {
    const acc = await newAccount(am);
    const s = await createOpportunity(am, {
      accountId: acc.id,
      name: uniq('Fc '),
      vertical: 'AI',
      engine: 'D',
      amount: '100000',
      close: '2026-12-10',
      firstContact: '2026-11-02',
      contact: { firstName: 'A', lastName: 'B', jobTitle: 'CIO', roles: ['ECONOMIC_BUYER'] },
    });
    await qualifyTo(am, s, 2);
    const r = await am.patch(`/opportunities/${s.oppId}/forecast`, { forecastCategory: 'COMMIT' });
    expect(r.body.meta.warnings).toEqual(['CATEGORY_INCONSISTENT']);
    const cur = await okData(am.get('/forecast/current'));
    expect(cur.cadence).toBe('REPORT'); // 2026-11-04 is a Wednesday
    expect(Number(cur.totals.commit)).toBeGreaterThan(0);
    expect((await am.post('/forecast/snapshots')).status).toBe(403);
    const cmW45 = client(app, await as(app, ['COUNTRY_MANAGER']), '2026-11-04');
    const snap = await okData(cmW45.post('/forecast/snapshots'));
    expect((await cmW45.post('/forecast/snapshots')).status).toBe(409);
    await expect(
      app.ctx.pool.query(`UPDATE forecast_snapshot_items SET stage = 9 WHERE snapshot_id = $1`, [
        snap.id,
      ]),
    ).rejects.toThrow(/append-only/);
    await okData(am.post(`/opportunities/${s.oppId}/transitions`, { toStage: 3 }));
    const snap2 = await okData(
      client(app, await as(app, ['COUNTRY_MANAGER']), '2026-11-11').post('/forecast/snapshots'),
    );
    const ch = await okData(am.get(`/forecast/changes?from=${snap.id}&to=${snap2.id}`));
    expect(
      ch.changes.find((c: { opportunityId: string }) => c.opportunityId === s.oppId),
    ).toMatchObject({ change: 'ADVANCED', from: 2, to: 3 });
    const acc4 = await okData(am.get('/forecast/accuracy?period=2026Q4'));
    expect(acc4).toHaveProperty('deviation');
    const rep = await okData(am.get(`/forecast/report?snapshotId=${snap2.id}`));
    expect(rep.previousSnapshotId).toBe(snap.id);
  });
});

describe('P13 distributors', () => {
  it('agreement, channel conflict review and CM decision; expired agreement blocks', async () => {
    const d = await okData(
      am.post('/distributors', {
        name: uniq('Robotic Work '),
        countryCode: 'CL',
        status: 'ACTIVE',
      }),
    );
    expect(
      (
        await am.post(`/distributors/${d.id}/agreements`, {
          marginPct: '0.2',
          startsOn: '2026-01-01',
          endsOn: '2026-12-31',
        })
      ).status,
    ).toBe(403);
    await okData(
      cm.post(`/distributors/${d.id}/agreements`, {
        territories: ['CL'],
        verticals: ['ROBOTICS'],
        marginPct: '0.2',
        startsOn: '2026-01-01',
        endsOn: '2026-12-31',
      }),
    );
    const acc = await newAccount(am, { vertical: 'ROBOTICS' });
    await createOpportunity(am, {
      accountId: acc.id,
      name: 'Directa',
      vertical: 'ROBOTICS',
      engine: 'E',
      amount: '50000',
      close: '2026-12-01',
      firstContact: '2026-11-02',
      contact: { firstName: 'A', lastName: 'B', jobTitle: 'X', roles: [] },
    });
    const reg = await okData(
      am.post('/deal-registrations', {
        distributorId: d.id,
        accountId: acc.id,
        registeredOn: '2026-11-04',
      }),
    );
    expect(reg.status).toBe('CONFLICT_REVIEW');
    expect(reg.conflict.opportunityIds).toHaveLength(1);
    expect(
      (await am.post(`/deal-registrations/${reg.id}/decision`, { status: 'APPROVED', reason: 'x' }))
        .status,
    ).toBe(403);
    expect(
      (
        await okData(
          cm.post(`/deal-registrations/${reg.id}/decision`, {
            status: 'REJECTED',
            reason: 'Cuenta directa',
          }),
        )
      ).status,
    ).toBe('REJECTED');
    await okData(
      cm.post(`/distributors/${d.id}/trainings`, {
        kind: 'DEMO',
        heldOn: '2026-11-03',
        product: 'AgiBot inspección',
      }),
    );
    const old = await okData(am.post('/distributors', { name: uniq('IGPS '), countryCode: 'CL' }));
    await okData(
      cm.post(`/distributors/${old.id}/agreements`, {
        marginPct: '0.1',
        startsOn: '2025-01-01',
        endsOn: '2025-12-31',
      }),
    );
    const contact = await okData(
      am.post(`/accounts/${acc.id}/contacts`, { firstName: 'C', lastName: 'D' }),
    );
    const r = await am.post('/opportunities', {
      name: 'Vía canal',
      accountId: acc.id,
      contactId: contact.id,
      countryCode: 'CL',
      vertical: 'ROBOTICS',
      billingEngine: 'E',
      origin: 'DISTRIBUTOR',
      distributorId: old.id,
      amount: '1000',
      currency: 'USD',
      expectedCloseDate: '2026-12-01',
      firstContactDate: '2026-11-03',
    });
    expect(codes(r)).toEqual(['DISTRIBUTOR_AGREEMENT_EXPIRED']);
  });
});

describe('P14 compliance', () => {
  it('engine E requires export control; unanswered blocks; only Legal reviews, only CM approves', async () => {
    const acc = await newAccount(am, { vertical: 'ROBOTICS' });
    const s = await createOpportunity(am, {
      accountId: acc.id,
      name: uniq('Robots '),
      vertical: 'ROBOTICS',
      engine: 'E',
      amount: '80000',
      close: '2026-12-01',
      firstContact: '2026-11-02',
      contact: { firstName: 'A', lastName: 'B', jobTitle: 'X', roles: [] },
    });
    const c = await okData(am.post(`/opportunities/${s.oppId}/compliance-checklists`));
    expect(c.requiredSections).toContain('EXPORT_CONTROL');
    expect(codes(await am.post(`/compliance-checklists/${c.id}/submit`))).toEqual([
      'COMPLIANCE_ITEMS_UNANSWERED',
    ]);
    await okData(
      am.put(
        `/compliance-checklists/${c.id}/items`,
        c.items.map((i: { itemCode: string }) => ({ itemCode: i.itemCode, answer: 'NA' })),
      ),
    );
    await okData(am.post(`/compliance-checklists/${c.id}/submit`));
    expect(
      (await am.post(`/compliance-checklists/${c.id}/review`, { status: 'REVIEWED' })).status,
    ).toBe(403);
    expect(
      codes(await legal.post(`/compliance-checklists/${c.id}/review`, { status: 'REJECTED' })),
    ).toEqual(['COMMENT_REQUIRED']);
    await okData(legal.post(`/compliance-checklists/${c.id}/review`, { status: 'REVIEWED' }));
    expect((await legal.post(`/compliance-checklists/${c.id}/approve`)).status).toBe(403);
    expect((await okData(cm.post(`/compliance-checklists/${c.id}/approve`))).status).toBe(
      'APPROVED',
    );
  });
});

describe('P15 onboarding', () => {
  it('country kit, checklist, items done by the person, time to first opportunity, overdue job', async () => {
    await okData(
      cm.put('/onboarding/kits/CO', { items: ['MANUAL', 'ACCESS_CRM'], productiveDays: 30 }),
    );
    const newbie = await as(app, ['ACCOUNT_MANAGER'], { countryCodes: ['CO', 'CL'] });
    const c = await okData(
      cm.post('/onboarding', { userId: newbie.userId, countryCode: 'CO', startDate: '2026-10-01' }),
    );
    const me = client(app, newbie);
    expect(
      (await okData(me.patch(`/onboarding/${c.id}/items/MANUAL`, { done: true }))).pending,
    ).toBe(1);
    const acc = await newAccount(me);
    await createOpportunity(me, {
      accountId: acc.id,
      name: 'Primera',
      vertical: 'TELECOM_BSS',
      engine: 'A',
      amount: '1000',
      close: '2026-12-01',
      firstContact: '2026-11-02',
      contact: { firstName: 'A', lastName: 'B', jobTitle: 'X', roles: [] },
    });
    const list = await okData(cm.get('/onboarding'));
    const row = list.find((x: { id: string }) => x.id === c.id);
    expect(row).toMatchObject({ done: 1, total: 2, overdue: true });
    expect(row.daysToFirstOpportunity).toBeGreaterThan(0);
    const job = await okData(admin.post('/admin/jobs/onboarding.daily/run'));
    expect(job.result.overdue).toBeGreaterThanOrEqual(1);
    // no P15 letter: only their own checklist
    const dl = await as(app, ['LOCAL_DELIVERY']);
    await okData(
      cm.post('/onboarding', { userId: dl.userId, countryCode: 'CL', startDate: '2026-11-02' }),
    );
    const mine = await okData(client(app, dl).get('/onboarding'));
    expect(mine.map((x: { userId: string }) => x.userId)).toEqual([dl.userId]);
  });
});

describe('P16 resident capacity', () => {
  it('805/1000 h → 80 % alert; > 100 % → critical and hours without PO', async () => {
    const acc = await newAccount(am);
    const k = await okData(
      am.post('/contracts', {
        accountId: acc.id,
        type: 'OC',
        number: uniq('R'),
        title: 'OC residentes',
        billingEntityId: entityId,
        amount: '90000',
        currency: 'USD',
      }),
    );
    const ld = client(app, await as(app, ['LOCAL_DELIVERY']));
    const po = await okData(
      ld.post('/resident-pos', { contractId: k.id, poNumber: k.number, totalHours: '1000' }),
    );
    const csv = `po_number;resident;hours\n${k.number};Ana;405\n${k.number};Luis;400\nOC-INEXISTENTE;Pedro;12\n`;
    expect(
      (await am.post('/resident-pos/hours-imports', { month: '2026-10-01', csv })).status,
    ).toBe(403);
    const r1 = await okData(ld.post('/resident-pos/hours-imports', { month: '2026-10-01', csv }));
    expect(r1.report).toEqual([{ row: 4, code: 'PO_NOT_FOUND', poNumber: 'OC-INEXISTENTE' }]);
    let p = (await okData(am.get('/resident-pos'))).find((x: { id: string }) => x.id === po.id);
    expect(p).toMatchObject({ alert: 'WARN_80', pct: 0.805, consumedHours: '805.00' });
    await okData(
      ld.post('/resident-pos/hours-imports', {
        month: '2026-11-01',
        csv: `po_number,resident,hours\n${k.number},Ana,300\n`,
      }),
    );
    p = (await okData(am.get('/resident-pos'))).find((x: { id: string }) => x.id === po.id);
    expect(p).toMatchObject({ alert: 'CRITICAL_100', excessHours: '105.00' });
    const without = await okData(am.get('/reports/hours-without-po'));
    expect(without.map((w: { poNumber: string }) => w.poNumber)).toEqual(
      expect.arrayContaining(['OC-INEXISTENTE', k.number]),
    );
    const n = await app.ctx.pool.query(
      `SELECT count(*)::int n FROM notifications WHERE dedupe_key LIKE $1`,
      [`capacity:${po.id}:%`],
    );
    expect(n.rows[0].n).toBeGreaterThanOrEqual(2);
  });
});

describe('admin, notifications and jobs', () => {
  it('users and roles; RACI versioning changes permissions; settings validated with history', async () => {
    expect((await am.get('/admin/users')).status).toBe(403);
    const email = `${uniq('nuevo')}@test.local`;
    await okData(
      admin.post('/admin/users', {
        email,
        fullName: 'Nuevo VP',
        password: 'Password-Larga-2026',
        roles: ['VP'],
      }),
    );
    const listed: { email: string; roles: string[] }[] = await okData(admin.get('/admin/users'));
    expect(listed.find((u) => u.email === email)?.roles).toEqual(['VP']);
    const vp = client(app, await login(app, email, 'Password-Larga-2026'));
    const accs = await okData(vp.get('/opportunities'));
    expect(Array.isArray(accs)).toBe(true);
    expect((await vp.post('/accounts', {})).status).toBe(403);
    await okData(
      admin.put('/admin/raci', {
        comment: 'VP escribe en P1',
        entries: [{ process: 'P1', role: 'VP', letters: ['R'] }],
      }),
    );
    expect((await vp.post('/accounts', {})).status).toBe(400);
    await okData(
      admin.put('/admin/raci', {
        comment: 'revert',
        entries: [{ process: 'P1', role: 'VP', letters: [] }],
      }),
    );
    expect(
      codes(
        await admin.put('/admin/raci', {
          comment: 'x',
          entries: [{ process: 'ADM', role: 'ADMIN', letters: ['C'] }],
        }),
      ),
    ).toEqual(['RACI_ADMIN_LOCKOUT']);
    expect(
      (
        await admin.put('/admin/settings/invoices.defaultPaymentTermDays', {
          value: -3,
          reason: 'x',
        })
      ).status,
    ).toBe(400);
    await okData(
      admin.put('/admin/settings/invoices.defaultPaymentTermDays', {
        value: 60,
        reason: 'Contrato marco',
      }),
    );
    expect(
      (await okData(am.get('/settings/public'))).settings['invoices.defaultPaymentTermDays'],
    ).toBe(60);
    expect(
      (await okData(admin.get('/admin/settings/invoices.defaultPaymentTermDays/history')))[0].value,
    ).toBe(60);
    await okData(
      admin.put('/admin/settings/invoices.defaultPaymentTermDays', { value: 45, reason: 'revert' }),
    );
    await okData(
      admin.post('/admin/calendars/CL/holidays', { date: '2026-12-31', name: 'Feriado bancario' }),
    );
    const cals = await okData(admin.get('/admin/calendars'));
    expect(
      cals
        .find((c: { id: string }) => c.id === 'CL')
        .holidays.some((h: { date: string }) => h.date === '2026-12-31'),
    ).toBe(true);
    await okData(admin.delete('/admin/calendars/CL/holidays/2026-12-31'));
  });

  it('jobs run on demand: SLA scan, collections and audit verification; bell notifications', async () => {
    const sla = await okData(
      client(app, await as(app, ['ADMIN'], { countryCodes: ['*'] }), '2027-03-01').post(
        '/admin/jobs/sla.scan/run',
      ),
    );
    expect(sla.result).toHaveProperty('notifications');
    const col = await okData(
      client(app, await as(app, ['ADMIN'], { countryCodes: ['*'] }), '2027-03-01').post(
        '/admin/jobs/collections.daily/run',
      ),
    );
    expect(col.result).toHaveProperty('steps');
    expect((await okData(admin.post('/admin/jobs/audit.verify/run'))).result.ok).toBe(true);
    const r = await am.get('/notifications');
    expect(r.body.meta).toHaveProperty('unread');
    await okData(am.post('/notifications/read-all'));
    expect((await am.get('/notifications')).body.meta.unread).toBe(0);
  });
});

describe('imports and exports', () => {
  it('CSV import of accounts, opportunities and invoices with per-row report', async () => {
    const a1 = uniq('ImpCo ');
    const rep = await okData(
      cm.post('/imports/accounts', {
        csv: `name;vertical;customerType;currency\n${a1};AI;NEW;USD\nSinVertical;;NEW;USD\n`,
      }),
    );
    expect(rep).toMatchObject({ rowsOk: 1, created: { accounts: 1 } });
    expect(rep.errors[0]).toMatchObject({ row: 3, code: 'VALIDATION_ERROR' });
    expect((await am.post('/imports/accounts', { csv: 'name\nx' })).status).toBe(403);
    const opps = await okData(
      cm.post('/imports/opportunities', {
        csv: `name,accountName,billingEngine,amount,currency,expectedCloseDate,legacyStatus\nImport TP,${a1},A,"1.200.000",USD,31/12/2026,TP Sent\nSin motor,${a1},,10,USD,2026-12-31,\n`,
      }),
    );
    expect(opps.rowsOk).toBe(1);
    expect(opps.errors[0].code).toBe('ENGINE_REQUIRED');
    const list = await okData(cm.get(`/opportunities?q=Import TP`));
    expect(list[0]).toMatchObject({ stage: 5, legacyStatus: 'TP Sent', amount: '1200000.00' });
    const inv = await okData(
      cm.post('/imports/invoices', {
        csv: `opportunityCode,number,issuedOn,amount,currency,paidAmount,paidOn\n${list[0].code},${uniq('F')},2026-09-01,1000,USD,400,2026-10-01\n`,
      }),
    );
    expect(inv.created).toMatchObject({ milestones: 1, invoices: 1, payments: 1 });
  });

  it('legacy tracker_data.json: dry run then import (idempotent)', async () => {
    const tag = uniq('');
    const data = {
      wom: [
        {
          status: 'PO',
          po: `45${tag}`,
          name: `CR Portabilidad ${tag}`,
          expected: 120000,
          po_net: 118000,
          risk: 'Low',
        },
        { status: 'PVB', name: `V9 ${tag}`, expected: 1850000, risk: 'High' },
        { status: 'Cancelled', name: `Data lake ${tag}`, expected: 5000 },
      ],
      new_clients: [
        {
          status: 'Preparing RFP',
          client: `Nuevo ${tag}`,
          name: `RFI ${tag}`,
          expected: 90000,
          quarter: 'Q1 2027',
        },
      ],
      billing: [
        {
          name: `CR Portabilidad ${tag}`,
          reception: '2026-07-01',
          usd: 118000,
          invoice_no: `L-${tag}`,
          invoice_date: '2026-07-05',
          due: '2026-08-19',
          status: 'Paid',
        },
        { name: `Inexistente ${tag}`, usd: 10, status: 'Pending' },
      ],
    };
    const dry = await okData(cm.post('/imports/legacy-tracker', { data, dryRun: true }));
    expect(dry).toMatchObject({ dryRun: true, created: { opportunities: 4 } });
    expect((await okData(cm.get(`/opportunities?q=${tag}`))).length).toBe(0);
    const real = await okData(cm.post('/imports/legacy-tracker', { data }));
    expect(real.created).toMatchObject({
      opportunities: 4,
      contracts: 1,
      invoices: 1,
      payments: 1,
    });
    expect(real.errors.map((e: { code: string }) => e.code)).toEqual(['OPPORTUNITY_NOT_FOUND']);
    const opps = await okData(cm.get(`/opportunities?q=${tag}`));
    const byName = Object.fromEntries(
      opps.map((o: { name: string; stage: number; status: string }) => [
        o.name,
        `${o.stage}/${o.status}`,
      ]),
    );
    expect(byName).toMatchObject({
      [`CR Portabilidad ${tag}`]: '7/OPEN',
      [`V9 ${tag}`]: '6/OPEN',
      [`Data lake ${tag}`]: '3/LOST',
      [`RFI ${tag}`]: '3/OPEN',
    });
    const again = await okData(cm.post('/imports/legacy-tracker', { data }));
    expect(again.created.opportunities ?? 0).toBe(0);
    expect(again.skipped).toBeGreaterThanOrEqual(4);
  });

  it('exports CSV and XLSX (audited)', async () => {
    const csv = await cm.get('/exports/opportunities?format=csv');
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text.split('\r\n')[0]).toContain('code,name,account');
    const xlsx = await cm
      .get('/exports/dashboard?format=xlsx')
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    expect((await am.get('/exports/dashboard?format=csv')).status).toBe(200);
    expect(
      (await client(app, await as(app, ['CHINA_LEGAL'])).get('/exports/invoices')).status,
    ).toBe(200);
    const n = await app.ctx.pool.query(
      `SELECT count(*)::int n FROM audit_log WHERE action='EXPORT'`,
    );
    expect(n.rows[0].n).toBeGreaterThanOrEqual(3);
  });

  it('neutralizes spreadsheet formulas in CSV and XLSX exports (QA-006)', async () => {
    const evil = `=HYPERLINK("http://evil.example","${uniq('x')}")`;
    await newAccount(cm, { name: evil });
    const csv = await cm.get('/exports/accounts?format=csv');
    expect(csv.text).toContain(`"'${evil.replace(/"/g, '""')}"`);
    expect(csv.text).not.toMatch(/(^|,|\r\n)"?=HYPERLINK/);
    const xlsx = await cm
      .get('/exports/accounts?format=xlsx')
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.body as Buffer);
    const names = (wb.worksheets[0]!.getColumn(1).values as unknown[]).map(String);
    expect(names).toContain(`'${evil}`);
    expect(names).not.toContain(evil);
  });
});
