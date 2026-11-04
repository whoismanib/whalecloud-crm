import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, client, createTestApp, uniq } from '../../../test/helpers';
import { createOpportunity, okData } from '../../db/seed/flows';
import { runJob } from '../../jobs/index';

let app: FastifyInstance;
type C = ReturnType<typeof client>;
let am: C;
let cm: C;
let finance: C;
let rd: { userId: string; c: C };
let oppId: string;

const codes = (r: { body: { errors?: { code: string }[] } }) =>
  (r.body.errors ?? []).map((e) => e.code);

beforeAll(async () => {
  app = await createTestApp();
  am = client(app, await as(app, ['ACCOUNT_MANAGER']));
  cm = client(app, await as(app, ['COUNTRY_MANAGER']));
  finance = client(app, await as(app, ['CHINA_FINANCE'], { countryCodes: ['*'] }));
  const rdS = await as(app, ['CHINA_DELIVERY'], { countryCodes: ['*'] });
  rd = { userId: rdS.userId, c: client(app, rdS) };
  const cat = await okData(am.get('/catalogs'));
  const entity = cat.billingEntities.find((b: { code: string }) => b.code === 'WC_CL_SPA');
  const acc = await okData(
    am.post('/accounts', {
      name: uniq('Cuenta RFP '),
      countryCode: 'CL',
      vertical: 'TELECOM_BSS',
      customerType: 'NEW',
      defaultBillingEntityId: entity.id,
      currency: 'USD',
    }),
  );
  const o = await createOpportunity(am, {
    accountId: acc.id,
    name: uniq('RFP OSS '),
    vertical: 'TELECOM_BSS',
    engine: 'A',
    amount: '800000',
    close: '2027-02-15',
    firstContact: '2026-11-02',
    contact: { firstName: 'R', lastName: 'F', jobTitle: 'CIO', roles: ['ECONOMIC_BUYER'] },
  });
  oppId = o.oppId;
});
afterAll(async () => {
  await app.close();
});

describe('P3 Preventa RFI/RFP (QA-004)', () => {
  it('register → decision → matrix → CM review → delivery → result, with KPIs', async () => {
    // P3-01/02: dates computed on the CL calendar
    const r = await okData(
      am.post(`/opportunities/${oppId}/rfps`, {
        type: 'RFP',
        title: 'Licitación OSS 2027',
        receivedOn: '2026-11-04',
        clientDeadline: '2026-12-01',
        documentsUrl: 'https://repo.example.com/rfp-oss.pdf',
      }),
    );
    expect(r).toMatchObject({
      decision: 'PENDING',
      decisionDueOn: '2026-11-06',
      internalDeadline: '2026-11-24',
      alerts: [],
    });
    expect(
      codes(
        await am.post(`/opportunities/${oppId}/rfps`, {
          title: 'x',
          receivedOn: '2026-11-04',
          clientDeadline: '2026-11-01',
        }),
      ),
    ).toEqual(['DATE_RANGE_INVALID']);
    expect((await finance.post(`/opportunities/${oppId}/rfps`, {})).status).toBe(403);

    // delivery is blocked without decision, CM review (P3-04)
    expect(codes(await am.post(`/rfps/${r.id}/deliver`, {}))).toEqual([
      'RFP_DECISION_REQUIRED',
      'RFP_CM_REVIEW_REQUIRED',
    ]);
    // decision overdue after 2 business days → SLA alert to AM + CM
    await runJob('sla.scan', app.ctx, '2026-11-09');
    const n = await app.ctx.pool.query(
      `SELECT count(*)::int n FROM notifications WHERE dedupe_key = $1`,
      [`sla:rfp:${r.id}:DECISION_OVERDUE`],
    );
    expect(n.rows[0].n).toBeGreaterThanOrEqual(2);
    expect(codes(await am.post(`/rfps/${r.id}/decision`, { decision: 'DECLINE' }))).toEqual([
      'COMMENT_REQUIRED',
    ]);
    await okData(am.post(`/rfps/${r.id}/decision`, { decision: 'PARTICIPATE' }));
    expect(
      codes(await am.post(`/rfps/${r.id}/decision`, { decision: 'DECLINE', reason: 'x' })),
    ).toEqual(['STATUS_INVALID']);

    // P3-03: matrix with an item assigned to I+D (China Delivery, P3 "C")
    const reqs = await okData(
      am.post(`/rfps/${r.id}/requirements`, [
        { ref: '3.1', requirement: 'Soporte 24x7 en español' },
        { ref: '3.2', requirement: 'Integración con TMF Open APIs', assigneeUserId: rd.userId },
      ]),
    );
    expect(reqs).toHaveLength(2);
    const [a, b] = reqs as { id: string }[];
    await okData(am.patch(`/rfp-requirements/${a!.id}`, { answer: 'COMPLIES' }));
    // the assignee answers; someone else without P3 write cannot
    expect((await finance.patch(`/rfp-requirements/${b!.id}`, { answer: 'PARTIAL' })).status).toBe(
      403,
    );
    expect((await rd.c.patch(`/rfp-requirements/${b!.id}`, { assigneeUserId: null })).status).toBe(
      403,
    );
    const answered = await okData(
      rd.c.patch(`/rfp-requirements/${b!.id}`, { answer: 'PARTIAL', comment: 'TMF620 en fase 2' }),
    );
    expect(answered).toMatchObject({ answer: 'PARTIAL', answeredBy: rd.userId });
    const detail = await okData(am.get(`/rfps/${r.id}`));
    expect(detail.compliance).toEqual({ total: 2, answered: 2, pct: 0.75 });
    expect(detail.requirements[1].assigneeName).toBeTruthy();

    // CM review (only P3 A); a later matrix change invalidates it
    expect((await am.post(`/rfps/${r.id}/cm-review`, {})).status).toBe(403);
    await okData(cm.post(`/rfps/${r.id}/cm-review`, { comment: 'OK enviar' }));
    await okData(am.patch(`/rfp-requirements/${a!.id}`, { comment: 'Con NOC en Santiago' }));
    expect(codes(await am.post(`/rfps/${r.id}/deliver`, {}))).toEqual(['RFP_CM_REVIEW_REQUIRED']);
    await okData(cm.post(`/rfps/${r.id}/cm-review`, {}));
    const delivered = await okData(am.post(`/rfps/${r.id}/deliver`, {}));
    expect(delivered.deliveredOn).toBe('2026-11-04');
    expect(codes(await am.post(`/rfps/${r.id}/deliver`, {}))).toContain('RFP_ALREADY_DELIVERED');
    expect(codes(await am.patch(`/rfp-requirements/${a!.id}`, { answer: 'NOT_COMPLIES' }))).toEqual(
      ['RFP_ALREADY_DELIVERED'],
    );
    await okData(
      am.post(`/rfps/${r.id}/result`, {
        result: 'LOST',
        winningCompetitor: 'Amdocs',
        winningPrice: '700000',
        winningCurrency: 'USD',
      }),
    );

    // a second RFP delivered late and won; a third declined
    const r2 = await okData(
      am.post(`/opportunities/${oppId}/rfps`, {
        type: 'RFI',
        title: 'RFI analítica',
        receivedOn: '2026-10-01',
        clientDeadline: '2026-10-20',
      }),
    );
    expect(codes(await am.post(`/rfps/${r2.id}/result`, { result: 'WON' }))).toEqual([
      'RFP_NOT_DELIVERED',
    ]);
    await okData(am.post(`/rfps/${r2.id}/decision`, { decision: 'PARTICIPATE' }));
    await okData(cm.post(`/rfps/${r2.id}/cm-review`, {}));
    await okData(am.post(`/rfps/${r2.id}/deliver`, { deliveredOn: '2026-10-22' }));
    await okData(am.post(`/rfps/${r2.id}/result`, { result: 'WON' }));
    const r3 = await okData(
      am.post(`/opportunities/${oppId}/rfps`, {
        title: 'RFQ hardware',
        receivedOn: '2026-11-02',
        clientDeadline: '2026-11-30',
      }),
    );
    await okData(
      am.post(`/rfps/${r3.id}/decision`, { decision: 'DECLINE', reason: 'Fuera de foco' }),
    );

    const list = await cm.get('/rfps');
    expect(list.status).toBe(200);
    const mine = list.body.data.filter((x: { opportunityId: string }) => x.opportunityId === oppId);
    expect(mine).toHaveLength(3);
    expect(list.body.meta.kpis).toMatchObject({
      delivered: expect.any(Number),
      onTimePct: expect.any(Number),
      winRate: expect.any(Number),
    });
    const { rfpKpis } = await import('@wcrm/shared');
    expect(rfpKpis(mine)).toEqual({
      delivered: 2,
      onTimePct: 0.5,
      decided: 3,
      decisionOnTimePct: 0.6667,
      withResult: 2,
      winRate: 0.5,
    });
    expect((await okData(am.get(`/opportunities/${oppId}/rfps`))).length).toBe(3);
    const audit = await app.ctx.pool.query(
      `SELECT count(*)::int n FROM audit_log WHERE entity_type IN ('rfp','rfp_requirement') AND opportunity_id = $1`,
      [oppId],
    );
    expect(audit.rows[0].n).toBeGreaterThanOrEqual(10);
  });
});
