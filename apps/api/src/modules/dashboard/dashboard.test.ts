import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, client, createTestApp, uniq } from '../../../test/helpers';
import { okData, type ApiClient } from '../../db/seed/flows';

let app: FastifyInstance;
let cm: ApiClient;
let accountId: string;

beforeAll(async () => {
  app = await createTestApp();
  cm = client(app, await as(app, ['COUNTRY_MANAGER']));
  const be = (await okData(cm.get('/catalogs'))).billingEntities[0].id;
  accountId = (
    await okData(
      cm.post('/accounts', {
        name: uniq('WOM '),
        countryCode: 'CL',
        vertical: 'TELECOM_BSS',
        customerType: 'EXISTING',
        defaultBillingEntityId: be,
        currency: 'USD',
      }),
    )
  ).id;
});
afterAll(async () => {
  await app.close();
});

describe('dashboard (DASH-01, legacy Resumen)', () => {
  it('returns the 10 KPIs with targets and traffic lights, legacy cards and charts', async () => {
    const d = await okData(cm.get('/dashboard/kpis?year=2026&currency=CNY'));
    expect(d.kpis.map((k: { code: string }) => k.code)).toEqual([
      'SS_SIGNED',
      'MIX_NEW_EXISTING',
      'PAYMENTS',
      'RECOGNIZED_REVENUE',
      'PROFIT',
      'DIGITAL_SALES',
      'PIPELINE_COVERAGE',
      'PENDING_ACCEPTANCES',
      'OVERDUE_RECEIVABLES',
      'PRICE_TIME',
    ]);
    const ss = d.kpis[0];
    expect(ss.target).toBe(200);
    expect(['GREEN', 'AMBER', 'RED']).toContain(ss.rag);
    expect(d.kpis.find((k: { code: string }) => k.code === 'PROFIT')).toMatchObject({
      target: null,
      rag: 'NONE',
    });
    expect(d.legacy.projectsHealth).toHaveProperty('HEALTHY');
    expect(d.charts.funnel.map((f: { step: string }) => f.step)).toEqual([
      'SIGNED',
      'ACCEPTED',
      'INVOICED',
      'COLLECTED',
    ]);
    expect(d.charts.monthly).toHaveLength(12);
    const usd = await okData(cm.get('/dashboard/kpis?currency=USD'));
    expect(usd.kpis[0].target).toBeCloseTo(200 / 7.09, 1);
  });

  it('health list uses legacy thresholds', async () => {
    const h = await okData(cm.get('/dashboard/health'));
    for (const x of h) {
      if (x.status === 'HEALTHY') expect(x.score).toBeGreaterThanOrEqual(70);
      if (x.status === 'CRITICAL') expect(x.score).toBeLessThan(40);
    }
  });
});

describe('eDo-like tickets (legacy Incidentes)', () => {
  it('creates, ages and closes a ticket with "pelota en"', async () => {
    const t = await okData(
      cm.post('/tickets', {
        accountId,
        number: uniq('EDO-'),
        title: 'Falla en tasación prepago',
        priority: 'P1',
        ballIn: 'CLIENT',
        openedOn: '2026-10-20',
        slaDueOn: '2026-10-25',
      }),
    );
    const list = await okData(cm.get('/tickets'));
    const row = list.find((x: { id: string }) => x.id === t.id);
    expect(row).toMatchObject({ isOpen: true, agingDays: 15, slaOverdue: true, ballIn: 'CLIENT' });
    const closed = await okData(
      cm.patch(`/tickets/${t.id}`, { status: 'CLOSED', ballIn: 'WHALE' }),
    );
    expect(closed.closedOn).toBe('2026-11-04');
    const vp = client(app, await as(app, ['VP']));
    expect((await vp.patch(`/tickets/${t.id}`, { status: 'OPEN' })).status).toBe(403);
  });
});
