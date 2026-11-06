import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, client, createTestApp } from '../../../test/helpers';
import { okData, type ApiClient } from '../../db/seed/flows';
import { normalizeEdoItem, parseEdoDate } from '../../services/edoClient';

// Fictitious eDo items from the legacy dashboard's fixtures (no real tickets or people).
const RAW = resolve(__dirname, '../../../test/fixtures/edo_raw_fixture.json');
const NORMALIZED = resolve(__dirname, '../../../test/fixtures/edo_normalized_fixture.json');

describe('eDo client normalization (edo_client.py normalize_item)', () => {
  it('matches the legacy normalized output field by field', () => {
    const raw = JSON.parse(readFileSync(RAW, 'utf8'));
    const list = Array.isArray(raw) ? raw : (raw.resultData?.list ?? raw.list);
    const expected = new Map(
      (JSON.parse(readFileSync(NORMALIZED, 'utf8')).incidents as { id: string }[]).map((r) => [
        r.id,
        r,
      ]),
    );
    expect(list.length).toBe(expected.size);
    for (const it of list) {
      const a = normalizeEdoItem(it) as Record<string, unknown>;
      const b = expected.get(a.id as string) as Record<string, unknown>;
      for (const k of Object.keys(a)) if (k in b) expect([k, a[k]]).toEqual([k, b[k]]);
    }
  });

  it('reads eDo dates as China time', () => {
    expect(parseEdoDate('2026-10-28 05:53:00')).toBe('2026-10-28T05:53:00+08:00');
    expect(parseEdoDate('')).toBeNull();
    expect(parseEdoDate(Date.UTC(2026, 9, 27, 21, 53))).toBe('2026-10-28T05:53:00+08:00');
  });
});

describe('eDo sync and panel (fixture mode)', () => {
  let app: FastifyInstance;
  let am: ApiClient;
  beforeAll(async () => {
    app = await createTestApp({ EDO_FIXTURE: RAW, EDO_ACCESS_TOKEN: '' });
    am = client(app, await as(app, ['ACCOUNT_MANAGER']));
  });
  afterAll(async () => {
    await app.close();
  });

  const waitIdle = async () => {
    for (let i = 0; i < 100; i++) {
      const s = await okData(am.get('/tickets/edo/status'));
      if (!s.busy) return s;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('sync did not finish');
  };

  it('an account manager presses Actualizar: tickets sync, KPIs come back; again is a no-op', async () => {
    const r = await am.post('/tickets/edo/refresh');
    expect(r.status).toBe(202);
    const s = await waitIdle();
    expect(s.lastError).toBeNull();
    expect(s.lastOk).toMatchObject({ mode: 'fixture', total: 62 });
    const p = await okData(am.get('/tickets/edo'));
    // Other test files share the database, so compare the KPIs with the rows they come from.
    const open = p.items.filter((i: { open: boolean }) => i.open).length;
    expect(open).toBeGreaterThanOrEqual(JSON.parse(readFileSync(NORMALIZED, 'utf8')).counts.open);
    expect(p.kpis.open).toBe(open);
    expect(p.kpis.whale + p.kpis.wom).toBe(open);
    expect(p.meta).toMatchObject({ source: 'fixture', sync: { configured: true, fixture: true } });
    expect(p.trends).toHaveLength(12);
    for (const g of p.groups) expect(g.summary).toContain('Hola');
    expect(p.items.find((i: { open: boolean }) => i.open).reminder).toContain('Hola');

    await am.post('/tickets/edo/refresh');
    const again = await waitIdle();
    expect(again.lastOk).toMatchObject({ created: 0, updated: 0 });
  });

  it('refuses to start without a token', async () => {
    const bare = await createTestApp({ EDO_FIXTURE: '', EDO_ACCESS_TOKEN: '' });
    try {
      const c = client(bare, await as(bare, ['ACCOUNT_MANAGER']));
      const r = await c.post('/tickets/edo/refresh');
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('EDO_SYNC_NOT_CONFIGURED');
    } finally {
      await bare.close();
    }
  });
});
