import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, client, createTestApp, uniq } from '../../../test/helpers';
import {
  createOpportunity,
  okData,
  qualification,
  qualifyTo,
  type ApiClient,
} from '../../db/seed/flows';

let app: FastifyInstance;
let am: ApiClient;
let entityId: string;

async function newAccount(c: ApiClient, customerType: 'NEW' | 'EXISTING' = 'NEW') {
  return okData(
    c.post('/accounts', {
      name: uniq('Cliente '),
      countryCode: 'CL',
      vertical: 'TELECOM_OSS',
      customerType,
      defaultBillingEntityId: entityId,
      currency: 'USD',
    }),
  );
}

async function newOpp(amount = '300000') {
  const acc = await newAccount(am);
  return createOpportunity(am, {
    accountId: acc.id,
    name: uniq('Opp '),
    vertical: 'TELECOM_OSS',
    engine: 'A',
    amount,
    close: '2026-12-15',
    firstContact: '2026-11-02',
    contact: { firstName: 'Ana', lastName: 'Pérez', jobTitle: 'CTO', roles: ['ECONOMIC_BUYER'] },
  });
}

beforeAll(async () => {
  app = await createTestApp();
  am = client(app, await as(app, ['ACCOUNT_MANAGER']));
  entityId = (await okData(am.get('/catalogs'))).billingEntities.find(
    (b: { code: string }) => b.code === 'WC_CL_SPA',
  ).id;
});
afterAll(async () => {
  await app.close();
});

describe('accounts (CORE-01)', () => {
  it('blocks missing mandatory fields with 400 VALIDATION_ERROR', async () => {
    const r = await am.post('/accounts', { name: 'Sin datos' });
    expect(r.status).toBe(400);
    expect(r.body.errors.map((e: { path: string }) => e.path)).toEqual(
      expect.arrayContaining([
        'countryCode',
        'vertical',
        'customerType',
        'defaultBillingEntityId',
        'currency',
      ]),
    );
  });

  it('warns on possible duplicate (409) and allows explicit confirmation', async () => {
    const acc = await newAccount(am);
    const body = {
      name: acc.name.toUpperCase(),
      countryCode: 'CL',
      vertical: 'AI',
      customerType: 'NEW',
      defaultBillingEntityId: entityId,
      currency: 'CLP',
    };
    const dup = await am.post('/accounts', body);
    expect(dup.status).toBe(409);
    expect(dup.body.errors[0]).toMatchObject({
      code: 'ACCOUNT_POSSIBLE_DUPLICATE',
      params: { existingId: acc.id },
    });
    expect((await am.post('/accounts?confirmDuplicate=true', body)).status).toBe(201);
  });
});

describe('opportunities (P1, CORE-02)', () => {
  it('creates at stage 0 with code, FX equivalents and late-registration flag (P1-02)', async () => {
    const acc = await newAccount(am);
    const contact = await okData(
      am.post(`/accounts/${acc.id}/contacts`, {
        firstName: 'Luis',
        lastName: 'Soto',
        buyingRoles: [],
      }),
    );
    const body = {
      name: 'GTD — Energy Optimizer',
      accountId: acc.id,
      contactId: contact.id,
      countryCode: 'CL',
      vertical: 'ENERGY',
      billingEngine: 'A',
      origin: 'EVENT',
      amount: '936000000',
      currency: 'CLP',
      expectedCloseDate: '2026-10-15',
      firstContactDate: '2026-11-02',
    };
    const res = await am.post('/opportunities', body);
    expect(res.status).toBe(201);
    const o = res.body.data;
    expect(o.stage).toBe(0);
    expect(o.code).toMatch(/^OPP-2026-\d{4}$/);
    expect(o.registeredLate).toBe(false);
    expect(o.amountMoney).toMatchObject({
      currency: 'CLP',
      usd: '1000000.00',
      fxMonth: '2026-10-01',
    });
    expect(Number(o.amountMoney.cny)).toBeCloseTo(7100000, 0);
    const late = await am.post('/opportunities', {
      ...body,
      name: 'tarde',
      firstContactDate: '2026-10-20',
    });
    expect(late.body.data.registeredLate).toBe(true);
  });

  it('requires the billing engine from creation and the distributor for channel origin', async () => {
    const r = await am.post('/opportunities', { name: 'x', origin: 'DISTRIBUTOR' });
    expect(r.status).toBe(422);
    const codes = r.body.errors.map((e: { code: string }) => e.code);
    expect(codes).toContain('ENGINE_REQUIRED');
    expect(codes).toContain('DISTRIBUTOR_REQUIRED');
  });

  it('0→1 blocked without pain, sponsor and BANT (422 STAGE_GATE_FAILED)', async () => {
    const s = await newOpp();
    const r = await am.post(`/opportunities/${s.oppId}/transitions`, { toStage: 1 });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('STAGE_GATE_FAILED');
    expect(r.body.errors.map((e: { code: string }) => e.code)).toEqual([
      'PAIN_MISSING',
      'SPONSOR_MISSING',
      'BANT_INCOMPLETE',
    ]);
  });

  it('MEDDPICC ≥ 50 % needed above USD 500 000 to reach stage 2 (P2-02)', async () => {
    const s = await newOpp('800000');
    await okData(am.put(`/opportunities/${s.oppId}/qualification`, qualification('EMPTY')));
    const o = await okData(am.get(`/opportunities/${s.oppId}`));
    await okData(
      am.patch(`/opportunities/${s.oppId}`, {
        rowVersion: o.rowVersion,
        pain: 'p',
        sponsorContactId: s.contactId,
      }),
    );
    await okData(am.post(`/opportunities/${s.oppId}/transitions`, { toStage: 1 }));
    const r = await am.post(`/opportunities/${s.oppId}/transitions`, { toStage: 2 });
    expect(r.body.errors.map((e: { code: string }) => e.code)).toEqual(['MEDDPICC_BELOW_50']);
    const q = await okData(
      am.put(`/opportunities/${s.oppId}/qualification`, qualification('HALF')),
    );
    expect(q.meddpiccScore).toBe(0.5);
    expect((await am.post(`/opportunities/${s.oppId}/transitions`, { toStage: 2 })).status).toBe(
      200,
    );
  });

  it('P2-03: no price request without economic buyer and decision date', async () => {
    const acc = await newAccount(am);
    const s = await createOpportunity(am, {
      accountId: acc.id,
      name: 'Coopeuch — Billetera',
      vertical: 'FINTECH',
      engine: 'A',
      amount: '300000',
      close: '2026-12-15',
      firstContact: '2026-11-02',
      contact: { firstName: 'Pía', lastName: 'Mora', jobTitle: 'Gerente TI', roles: ['CHAMPION'] },
    });
    await qualifyTo(am, s, 3, { decisionDate: null });
    const r = await am.post(`/opportunities/${s.oppId}/transitions`, { toStage: 4 });
    expect(r.status).toBe(422);
    expect(r.body.errors.map((e: { code: string }) => e.code)).toEqual([
      'ECONOMIC_BUYER_MISSING',
      'DECISION_DATE_MISSING',
      'PRICE_REQUEST_NOT_SUBMITTED',
    ]);
    const gates = await okData(am.get(`/opportunities/${s.oppId}/gates?toStage=4`));
    expect(gates.ok).toBe(false);
    const detail = await okData(am.get(`/opportunities/${s.oppId}`));
    expect(detail.nextGate.failures.map((f: { code: string }) => f.code)).toContain(
      'ECONOMIC_BUYER_MISSING',
    );
  });

  it('backward move needs a reason; stages 9–11 are derived (422 STAGE_DERIVED)', async () => {
    const s = await newOpp();
    await qualifyTo(am, s, 2);
    const back = await am.post(`/opportunities/${s.oppId}/transitions`, { toStage: 1 });
    expect(back.body.errors[0].code).toBe('BACKWARD_REASON_REQUIRED');
    expect(
      (
        await am.post(`/opportunities/${s.oppId}/transitions`, {
          toStage: 1,
          reason: 'Re-calificar',
        })
      ).status,
    ).toBe(200);
    const d = await am.post(`/opportunities/${s.oppId}/transitions`, { toStage: 9 });
    expect(d.body.errors[0].code).toBe('STAGE_DERIVED');
    const hist = await okData(am.get(`/opportunities/${s.oppId}`));
    expect(hist.stageHistory.map((h: { toStage: number }) => h.toStage)).toEqual([0, 1, 2, 1]);
  });

  it('closing LOST requires reason and winning competitor (CORE-10)', async () => {
    const s = await newOpp();
    const r = await am.post(`/opportunities/${s.oppId}/close`, { status: 'LOST' });
    expect(r.body.errors.map((e: { code: string }) => e.code)).toEqual([
      'CLOSE_REASON_REQUIRED',
      'WINNING_COMPETITOR_REQUIRED',
    ]);
    const ok = await am.post(`/opportunities/${s.oppId}/close`, {
      status: 'LOST',
      reason: 'Precio',
      winningCompetitor: 'Huawei',
      winningPrice: '250000',
      winningPriceCurrency: 'USD',
    });
    expect(ok.body.data.status).toBe('LOST');
    expect(
      (await am.post(`/opportunities/${s.oppId}/transitions`, { toStage: 1 })).body.errors[0].code,
    ).toBe('OPPORTUNITY_CLOSED');
  });

  it('optimistic concurrency: stale rowVersion → 409', async () => {
    const s = await newOpp();
    const o = await okData(am.get(`/opportunities/${s.oppId}`));
    await okData(am.patch(`/opportunities/${s.oppId}`, { rowVersion: o.rowVersion, risk: 'HIGH' }));
    expect(
      (await am.patch(`/opportunities/${s.oppId}`, { rowVersion: o.rowVersion, risk: 'LOW' }))
        .status,
    ).toBe(409);
  });

  it('activities update last activity (P1-03) and timeline lists audit events', async () => {
    const s = await newOpp();
    await okData(
      am.post('/activities', {
        accountId: s.accountId,
        opportunityId: s.oppId,
        type: 'MEETING',
        occurredAt: '2026-11-03',
        subject: 'Kickoff técnico',
      }),
    );
    const o = await okData(am.get(`/opportunities/${s.oppId}`));
    expect(o.lastActivityAt).toMatch(/^2026-11-03/);
    const tl = await okData(am.get(`/opportunities/${s.oppId}/timeline`));
    expect(tl.at(-1)).toMatchObject({ action: 'CREATE', entityType: 'opportunity' });
  });
});
