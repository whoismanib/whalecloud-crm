import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, client, createTestApp, uniq } from '../../test/helpers';
import { okData, type ApiClient } from '../db/seed/flows';

let app: FastifyInstance;
let am: ApiClient;
let admin: ApiClient;

beforeAll(async () => {
  app = await createTestApp();
  am = client(app, await as(app, ['ACCOUNT_MANAGER']));
  admin = client(app, await as(app, ['ADMIN'], { countryCodes: ['*'] }));
});
afterAll(async () => {
  await app.close();
});

describe('immutable audit log (ADM-10)', () => {
  it('records field changes; contact PII is masked', async () => {
    const be = (await okData(am.get('/catalogs'))).billingEntities[0].id;
    const acc = await okData(
      am.post('/accounts', {
        name: uniq('Audit '),
        countryCode: 'CL',
        vertical: 'AI',
        customerType: 'NEW',
        defaultBillingEntityId: be,
        currency: 'USD',
      }),
    );
    await okData(
      am.patch(`/accounts/${acc.id}`, { rowVersion: acc.rowVersion, isKeyAccount: true }),
    );
    await okData(
      am.post(`/accounts/${acc.id}/contacts`, {
        firstName: 'María',
        lastName: 'Secreta',
        email: 'm@x.cl',
      }),
    );
    const log = await okData(admin.get(`/audit-log?entityId=${acc.id}`));
    expect(log[0]).toMatchObject({
      action: 'UPDATE',
      category: 'DATA',
      changes: [{ field: 'isKeyAccount', old: false, new: true }],
    });
    const contactLog = await app.ctx.pool.query(
      `SELECT changes FROM audit_log WHERE entity_type = 'contact' AND account_id = $1`,
      [acc.id],
    );
    const ch = contactLog.rows[0].changes as { field: string; new: unknown }[];
    expect(ch.find((c) => c.field === 'lastName')?.new).toBe('[PII]');
    expect(JSON.stringify(ch)).not.toContain('Secreta');
  });

  it('UPDATE, DELETE and TRUNCATE on audit_log fail even for the owner role', async () => {
    await expect(app.ctx.pool.query(`UPDATE audit_log SET reason = 'x'`)).rejects.toThrow(
      /append-only/,
    );
    await expect(app.ctx.pool.query(`DELETE FROM audit_log`)).rejects.toThrow(/append-only/);
    await expect(app.ctx.pool.query(`TRUNCATE audit_log`)).rejects.toThrow(/append-only/);
    await expect(app.ctx.pool.query(`DELETE FROM stage_history`)).rejects.toThrow(/append-only/);
  });

  it('hash chain links every row and verifies', async () => {
    const r = await app.ctx.pool.query(
      `SELECT a.id, a.prev_hash = b.hash AS linked FROM audit_log a
       JOIN audit_log b ON b.id = (SELECT max(id) FROM audit_log WHERE id < a.id) ORDER BY a.id DESC LIMIT 20`,
    );
    expect(r.rows.every((x) => x.linked)).toBe(true);
    const v = await okData(admin.get('/audit-log/verify'));
    expect(v.ok).toBe(true);
    expect(v.checked).toBeGreaterThan(3);
  });
});
