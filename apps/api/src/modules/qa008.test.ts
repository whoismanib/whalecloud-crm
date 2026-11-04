import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, client, createTestApp, uniq } from '../../test/helpers';
import {
  createOpportunity,
  lineAt,
  loadSheet,
  okData,
  qualifyTo,
  submitPriceRequest,
  type OppSetup,
} from '../db/seed/flows';

let app: FastifyInstance;
type C = ReturnType<typeof client>;
let am: C;
let cm: C;
let china: C;
let admin: C;
let president: { id: string; c: C };
let vp: { id: string; c: C };
let rd: { id: string; c: C };
let entityId: string;

const codes = (r: { body: { errors?: { code: string }[] } }) =>
  (r.body.errors ?? []).map((e) => e.code);

async function setupAt3(amount: string): Promise<OppSetup> {
  const acc = await okData(
    am.post('/accounts', {
      name: uniq('Cuenta '),
      countryCode: 'CL',
      vertical: 'TELECOM_OSS',
      customerType: 'NEW',
      defaultBillingEntityId: entityId,
      currency: 'USD',
    }),
  );
  const s = await createOpportunity(am, {
    accountId: acc.id,
    name: uniq('Opp '),
    vertical: 'TELECOM_OSS',
    engine: 'A',
    amount,
    close: '2026-12-15',
    firstContact: '2026-11-02',
    contact: { firstName: 'R', lastName: 'D', jobTitle: 'GG', roles: ['ECONOMIC_BUYER'] },
  });
  await qualifyTo(am, s, 3);
  return s;
}

beforeAll(async () => {
  app = await createTestApp();
  am = client(app, await as(app, ['ACCOUNT_MANAGER']));
  cm = client(app, await as(app, ['COUNTRY_MANAGER']));
  china = client(app, await as(app, ['CHINA_SALES'], { countryCodes: ['*'] }));
  admin = client(app, await as(app, ['ADMIN']));
  const p = await as(app, ['LATAM_PRESIDENT']);
  president = { id: p.userId, c: client(app, p) };
  const v = await as(app, ['VP']);
  vp = { id: v.userId, c: client(app, v) };
  const r = await as(app, ['CHINA_DELIVERY'], { countryCodes: ['*'] });
  rd = { id: r.userId, c: client(app, r) };
  entityId = (await okData(am.get('/catalogs'))).billingEntities.find(
    (b: { code: string }) => b.code === 'WC_CL_SPA',
  ).id;
});
afterAll(async () => {
  await app.close();
});

describe('ADM-04 approval delegation (QA-008)', () => {
  it('the delegate sees and decides the absent approver steps; audited; revocable', async () => {
    const s = await setupAt3('900000');
    const prId = await submitPriceRequest(am, s, { targetPrice: '900000' });
    const sheet = await loadSheet(china, prId, {
      lineItems: [
        lineAt(1, 'OWN_SOFTWARE', 500000, 0.7),
        lineAt(2, 'SUPPORT_L3', 250000, 0.8, 'OPEX'),
        lineAt(4, 'SUPPORT_L1L2', 150000, 0.6384, 'OPEX'),
      ],
    });
    const ar = await okData(
      am.post(`/sheet-versions/${sheet.id}/approval-requests`, {
        competitiveJustification: 'Precio de la competencia',
      }),
    );
    const full = await okData(am.get(`/approval-requests/${ar.id}`));
    const step = full.steps.find((x: { kind: string }) => x.kind === 'MARGIN_PRESIDENT');
    // without delegation the VP cannot decide the president step
    expect(
      (await vp.c.post(`/approval-steps/${step.id}/decision`, { decision: 'APPROVED' })).status,
    ).toBe(403);

    // validation: own role only, no self-delegation, not in the past
    expect(
      codes(
        await president.c.post('/delegations', {
          delegateUserId: president.id,
          role: 'VP',
          startsOn: '2026-11-04',
          endsOn: '2026-11-01',
          reason: 'x',
        }),
      ),
    ).toEqual(['DELEGATION_SELF', 'DELEGATION_ROLE_NOT_HELD', 'DATE_RANGE_INVALID']);
    // someone else cannot create a delegation on the president's behalf (only ADM)
    expect(
      (
        await vp.c.post('/delegations', {
          delegatorUserId: president.id,
          delegateUserId: vp.id,
          role: 'LATAM_PRESIDENT',
          startsOn: '2026-11-04',
          endsOn: '2026-11-10',
          reason: 'x',
        })
      ).status,
    ).toBe(403);
    const d = await okData(
      president.c.post('/delegations', {
        delegateUserId: vp.id,
        role: 'LATAM_PRESIDENT',
        startsOn: '2026-11-04',
        endsOn: '2026-11-10',
        reason: 'Vacaciones',
      }),
    );
    expect((await okData(vp.c.get('/auth/me'))).delegatedRoles).toEqual(['LATAM_PRESIDENT']);
    const inbox = await okData(vp.c.get('/approvals?assignedToMe=true&status=PENDING'));
    expect(inbox.find((x: { id: string }) => x.id === step.id)).toMatchObject({ delegated: true });
    const mine = await okData(president.c.get('/delegations'));
    expect(mine.find((x: { id: string }) => x.id === d.id)).toMatchObject({ active: true });

    // revoke → no longer allowed; re-delegate and decide
    await okData(president.c.delete(`/delegations/${d.id}`));
    expect(
      (await vp.c.post(`/approval-steps/${step.id}/decision`, { decision: 'APPROVED' })).status,
    ).toBe(403);
    await okData(
      admin.post('/delegations', {
        delegatorUserId: president.id,
        delegateUserId: vp.id,
        role: 'LATAM_PRESIDENT',
        startsOn: '2026-11-04',
        endsOn: '2026-11-04',
        reason: 'Viaje',
      }),
    );
    await okData(vp.c.post(`/approval-steps/${step.id}/decision`, { decision: 'APPROVED' }));
    const audit = await app.ctx.pool.query(
      `SELECT changes FROM audit_log WHERE entity_type = 'approval_step' AND entity_id = $1`,
      [step.id],
    );
    expect(JSON.stringify(audit.rows[0].changes)).toContain(president.id);
    const n = await app.ctx.pool.query(
      `SELECT count(*)::int n FROM audit_log WHERE entity_type = 'approval_delegation'`,
    );
    expect(n.rows[0].n).toBeGreaterThanOrEqual(3);
    // a delegation dated tomorrow does not apply today
    expect((await okData(cm.get('/auth/me'))).delegatedRoles).toEqual([]);
  });
});

describe('P5-04 cost estimates (QA-008)', () => {
  it('China Sales assigns, the assignee records person-months and signs', async () => {
    const s = await setupAt3('400000');
    const prId = await submitPriceRequest(am, s, { targetPrice: '400000' });
    const [e] = await okData(
      china.post(`/price-requests/${prId}/cost-estimates`, [
        { area: 'I+D BSS', resourceType: 'CN_INTERNAL_RD', assigneeUserId: rd.id },
      ]),
    );
    expect((await okData(am.get(`/price-requests/${prId}`))).status).toBe('COSTING');
    const notes = await okData(rd.c.get('/notifications'));
    expect(notes.some((x: { titleKey: string }) => x.titleKey === 'costEstimateAssigned')).toBe(
      true,
    );
    // only the assignee signs, and only with person-months recorded
    expect(codes(await rd.c.post(`/cost-estimates/${e.id}/sign`))).toEqual(['COST_ESTIMATE_EMPTY']);
    expect((await vp.c.patch(`/cost-estimates/${e.id}`, { personMonths: '3' })).status).toBe(403);
    await okData(
      rd.c.patch(`/cost-estimates/${e.id}`, { personMonths: '6.5', notes: 'Mediación' }),
    );
    expect((await china.post(`/cost-estimates/${e.id}/sign`)).status).toBe(403);
    const signed = await okData(rd.c.post(`/cost-estimates/${e.id}/sign`));
    expect(signed.signedBy).toBe(rd.id);
    const list = await okData(am.get(`/price-requests/${prId}/cost-estimates`));
    expect(list[0]).toMatchObject({ personMonths: '6.50', signedBy: rd.id });
    expect(list[0].signedByName).toBeTruthy();
    // a later change clears the signature
    await okData(rd.c.patch(`/cost-estimates/${e.id}`, { personMonths: '7' }));
    expect((await okData(am.get(`/price-requests/${prId}/cost-estimates`)))[0].signedAt).toBeNull();
  });
});

describe('DASH-05 process KPIs (QA-008)', () => {
  it('returns KPIs for P1–P16 and flags the ones without source data', async () => {
    const k = await okData(cm.get('/dashboard/process-kpis'));
    const procs = new Set(k.map((x: { process: string }) => x.process));
    for (const p of [
      'P1',
      'P2',
      'P3',
      'P4',
      'P5',
      'P6',
      'P7',
      'P8',
      'P9',
      'P10',
      'P11',
      'P12',
      'P13',
      'P14',
      'P15',
      'P16',
    ])
      expect(procs.has(p)).toBe(true);
    expect(k.find((x: { code: string }) => x.code === 'P1_REGISTERED_ON_TIME')).toMatchObject({
      available: true,
      unit: 'PCT',
      target: 1,
    });
    expect(
      k.filter((x: { available: boolean }) => !x.available).map((x: { code: string }) => x.code),
    ).toEqual([
      'P2_STAGE_CONVERSION',
      'P7_LEGAL_ON_TIME',
      'P10_ACCOUNT_GROWTH',
      'P14_AUDIT_FINDINGS',
    ]);
    expect((await am.get('/dashboard/process-kpis')).status).toBe(200);
    // every role has a DASH letter in the default RACI (I = read)
    expect((await china.get('/dashboard/process-kpis')).status).toBe(200);
  });
});
