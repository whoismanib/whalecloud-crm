import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, client, createTestApp, uniq } from '../../test/helpers';
import { createOpportunity, okData, type ApiClient } from '../db/seed/flows';

let app: FastifyInstance;
let am: ApiClient;
let entityId: string;

beforeAll(async () => {
  app = await createTestApp();
  am = client(app, await as(app, ['ACCOUNT_MANAGER']));
  entityId = (await okData(am.get('/catalogs'))).billingEntities[0].id;
});
afterAll(async () => {
  await app.close();
});

describe('route guard contract (ARCHITECTURE §12 A01)', () => {
  it('every route is public, session-scoped or declares a RACI guard', () => {
    const unguarded = app.ctx.routes.filter((r) => !r.isPublic && !r.hasGuard);
    expect(unguarded).toEqual([]);
    const publicRoutes = app.ctx.routes.filter((r) => r.isPublic).map((r) => r.url);
    expect(publicRoutes.sort()).toEqual(['/api/v1/auth/login', '/healthz', '/readyz']);
    expect(app.ctx.routes.length).toBeGreaterThan(50);
  });
});

describe('RBAC from the RACI matrix (ADM-02)', () => {
  it('Legal China (— in P1) does not see a stage-0 opportunity; sees it once in a visible stage', async () => {
    const acc = await okData(
      am.post('/accounts', {
        name: uniq('Cuenta '),
        countryCode: 'CL',
        vertical: 'AI',
        customerType: 'NEW',
        defaultBillingEntityId: entityId,
        currency: 'USD',
      }),
    );
    const s = await createOpportunity(am, {
      accountId: acc.id,
      name: 'Visibilidad',
      vertical: 'AI',
      engine: 'D',
      amount: '100000',
      close: '2026-12-01',
      firstContact: '2026-11-03',
      contact: { firstName: 'X', lastName: 'Y', jobTitle: 'CIO', roles: [] },
    });
    const legal = client(app, await as(app, ['CHINA_LEGAL'], { countryCodes: ['*'] }));
    expect((await legal.get(`/opportunities/${s.oppId}`)).status).toBe(404);
    const list = await okData(legal.get('/opportunities'));
    expect(list.find((o: { id: string }) => o.id === s.oppId)).toBeUndefined();
    expect((await legal.get('/accounts')).status).toBe(403);
    // the AM sees it
    expect((await am.get(`/opportunities/${s.oppId}`)).status).toBe(200);
    // explicit assignment grants visibility
    await app.ctx.pool.query(
      `INSERT INTO opportunity_assignments (opportunity_id, user_id, reason)
       SELECT $1, u.id, 'WATCHER' FROM users u JOIN user_roles r ON r.user_id = u.id
       WHERE r.role = 'CHINA_LEGAL' ORDER BY u.created_at DESC LIMIT 1`,
      [s.oppId],
    );
    expect((await legal.get(`/opportunities/${s.oppId}`)).status).toBe(200);
  });

  it('country filter: a CL-only AM does not see a CO opportunity', async () => {
    const acc = await okData(
      am.post('/accounts', {
        name: uniq('Tigo '),
        countryCode: 'CO',
        vertical: 'TELECOM_BSS',
        customerType: 'NEW',
        defaultBillingEntityId: entityId,
        currency: 'USD',
      }),
    );
    const contact = await okData(
      am.post(`/accounts/${acc.id}/contacts`, { firstName: 'A', lastName: 'B' }),
    );
    const o = await okData(
      am.post('/opportunities', {
        name: 'Tigo BSS',
        accountId: acc.id,
        contactId: contact.id,
        countryCode: 'CO',
        vertical: 'TELECOM_BSS',
        billingEngine: 'A',
        origin: 'OUTBOUND',
        amount: '100',
        currency: 'USD',
        expectedCloseDate: '2026-12-01',
        firstContactDate: '2026-11-03',
      }),
    );
    expect((await am.get(`/opportunities/${o.id}`)).status).toBe(404);
    const coAm = client(app, await as(app, ['ACCOUNT_MANAGER'], { countryCodes: ['CO'] }));
    expect((await coAm.get(`/opportunities/${o.id}`)).status).toBe(200);
  });

  it.each([
    ['CHINA_FINANCE', 'post', '/opportunities', 403],
    ['CHINA_LEGAL', 'post', '/accounts', 403],
    ['VP', 'post', '/tickets', 403],
    ['ACCOUNT_MANAGER', 'get', '/audit-log', 403],
    ['ACCOUNT_MANAGER', 'get', '/audit-log/verify', 403],
    ['ADMIN', 'get', '/audit-log/verify', 200],
    [
      'ADMIN',
      'post',
      '/sheet-versions/00000000-0000-0000-0000-000000000000/approval-requests',
      403,
    ],
    ['COUNTRY_MANAGER', 'get', '/audit-log', 200],
    ['LATAM_PRESIDENT', 'get', '/dashboard/kpis', 200],
    ['ACCOUNT_MANAGER', 'post', '/fx-rates', 403],
  ] as const)('%s %s %s → %i', async (role, method, url, status) => {
    const c = client(app, await as(app, [role], { countryCodes: ['*'] }));
    const res = method === 'get' ? await c.get(url) : await c.post(url, {});
    expect(res.status).toBe(status);
  });
});
