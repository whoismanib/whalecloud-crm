import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, client, createTestApp, uniq } from '../../../test/helpers';
import { okData } from '../../db/seed/flows';

let app: FastifyInstance;
type C = ReturnType<typeof client>;
let cm: C;
let am: C;

beforeAll(async () => {
  app = await createTestApp();
  cm = client(app, await as(app, ['COUNTRY_MANAGER']));
  am = client(app, await as(app, ['ACCOUNT_MANAGER']));
});
afterAll(async () => {
  await app.close();
});

interface T {
  id: string;
  number: string;
  accountName: string;
  status: string;
  ballIn: string;
  priority: string;
  openedOn: string;
  closedOn: string | null;
  slaDueOn: string | null;
  orgHolder: string | null;
  ownerName: string | null;
  notes: string | null;
  externalId: string | null;
  externalUrl: string | null;
  isOpen: boolean;
}

/** Rows in the legacy `edo_incidents.json` shape (fictitious, like edo_re/fixtures). */
function rows(tag: string) {
  const base = {
    title: 'Portabilidad rechazada sin motivo',
    priority: 'P1',
    statusName: 'Assigned',
    org: 'WhaleCloudSupport',
    side: 'Whale',
    assignee: 'Li Wei',
    created: '2026-10-28T05:53:04+08:00',
    updated: '2026-10-29T01:04:56+08:00',
    resolved: null,
    closed: null,
    resSlaLimit: '2026-10-29T20:27:04+08:00',
    comment: 'no se importa',
  };
  return [
    { ...base, id: `${tag}-1`, no: `${tag}_IS1`, status: 1, open: true },
    {
      ...base,
      id: `${tag}-2`,
      no: `${tag}_IS2`,
      status: 3,
      statusName: 'In Progress',
      open: true,
      org: 'WOM',
      side: 'WOM',
      priority: '',
      resSlaLimit: null,
    },
    {
      ...base,
      id: `${tag}-3`,
      no: `${tag}_IS3`,
      status: 5,
      statusName: 'Closed',
      open: false,
      closed: '2026-10-30T01:18:28+08:00',
    },
    // eDo reused this number for an older ticket: different id, same number.
    {
      ...base,
      id: `${tag}-4`,
      no: `${tag}_IS3`,
      status: 4,
      statusName: 'Resloved',
      open: false,
      created: '2021-09-03T03:35:20+08:00',
      updated: null,
      resolved: '2021-09-10T10:00:00+08:00',
    },
    { ...base, id: '', no: `${tag}_IS5`, status: 1, open: true },
  ];
}

describe('eDo incidents import (legacy edo_incidents.json)', () => {
  it('dry-run, real run, idempotent re-run and update by eDo id', async () => {
    const tag = uniq('EDO').replace(/\W/g, '');
    const accountName = `WOM ${tag}`;
    const data = { generated_at: '2026-11-03T14:49:27+00:00', incidents: rows(tag) };
    const mine = async () =>
      ((await okData(cm.get('/tickets'))) as T[]).filter((t) => t.accountName === accountName);

    const dry = await okData(
      cm.post('/imports/edo-incidents', { data, accountName, dryRun: true }),
    );
    expect(dry).toMatchObject({
      dryRun: true,
      rowsTotal: 5,
      rowsOk: 4,
      created: { accounts: 1, tickets: 4 },
    });
    expect(dry.errors.map((e: { code: string }) => e.code)).toEqual(['EDO_ID_MISSING']);
    expect(dry.warnings.map((e: { code: string }) => e.code)).toEqual(['EDO_PRIORITY_ASSUMED']);
    expect(await mine()).toHaveLength(0);

    const real = await okData(cm.post('/imports/edo-incidents', { data, accountName }));
    expect(real.created).toEqual({ accounts: 1, tickets: 4 });
    const list = await mine();
    expect(list).toHaveLength(4);
    const open = list.filter((t) => t.isOpen);
    expect(open.map((t) => `${t.number}/${t.status}/${t.ballIn}`).sort()).toEqual([
      `${tag}_IS1/OPEN/WHALE`,
      `${tag}_IS2/IN_PROGRESS/CLIENT`,
    ]);
    const t1 = list.find((t) => t.externalId === `${tag}-1`)!;
    expect(t1).toMatchObject({
      priority: 'P1',
      openedOn: '2026-10-27', // 05:53 in China = 18:53 the day before in Santiago
      slaDueOn: '2026-10-29',
      orgHolder: 'WhaleCloudSupport',
      ownerName: 'Li Wei',
      externalUrl: `https://edo.iwhalecloud.com?issueId=${tag}-1`,
    });
    expect(list.find((t) => t.externalId === `${tag}-2`)!.priority).toBe('P3');
    expect(
      list
        .filter((t) => t.number === `${tag}_IS3`)
        .map((t) => `${t.status}/${t.closedOn}`)
        .sort(),
    ).toEqual(['CLOSED/2026-10-29', 'RESOLVED/2021-09-09']);

    const again = await okData(cm.post('/imports/edo-incidents', { data, accountName }));
    expect(again.created).toEqual({});
    expect(again.updated).toEqual({});
    expect(again.skipped).toBe(4);

    // A CRM note survives later imports (lastUpdateAt keeps mirroring eDo).
    await okData(cm.patch(`/tickets/${t1.id}`, { notes: 'llamar a WOM el lunes' }));
    const changed = rows(tag);
    Object.assign(changed[0]!, {
      status: 5,
      statusName: 'Closed',
      open: false,
      org: 'WOM',
      side: 'WOM',
      updated: '2026-11-02T10:00:00+08:00',
      closed: '2026-11-02T10:00:00+08:00',
    });
    const upd = await okData(
      cm.post('/imports/edo-incidents', { data: { incidents: changed }, accountName }),
    );
    expect(upd.updated).toEqual({ tickets: 1 });
    expect(upd.skipped).toBe(3);
    const after = (await mine()).find((t) => t.id === t1.id)!;
    expect(after).toMatchObject({
      status: 'CLOSED',
      ballIn: 'CLIENT',
      closedOn: '2026-11-01',
      notes: 'llamar a WOM el lunes',
    });
    expect(await mine()).toHaveLength(4);

    const jobs = await okData(cm.get('/imports'));
    expect(jobs[0]).toMatchObject({ kind: 'EDO_INCIDENTS', dryRun: false, rowsError: 1 });
  });

  it('links a ticket typed by hand with the same number instead of duplicating it', async () => {
    const tag = uniq('EDM').replace(/\W/g, '');
    const accountName = `WOM ${tag}`;
    const seed = await okData(
      cm.post('/imports/edo-incidents', {
        data: [rows(tag)[2]],
        accountName,
      }),
    );
    expect(seed.created.tickets).toBe(1);
    const accountId = ((await okData(cm.get('/tickets'))) as (T & { accountId: string })[]).find(
      (t) => t.accountName === accountName,
    )!.accountId;
    const manual = await okData(
      cm.post('/tickets', {
        accountId,
        number: `${tag}_IS1`,
        title: 'Cargado a mano',
        priority: 'P2',
        openedOn: '2026-10-27',
        notes: 'nota manual',
      }),
    );
    const r = await okData(cm.post('/imports/edo-incidents', { data: [rows(tag)[0]], accountId }));
    expect(r.created).toEqual({});
    expect(r.updated).toEqual({ ticketsLinked: 1 });
    const t = ((await okData(cm.get('/tickets'))) as T[]).find((x) => x.id === manual.id)!;
    expect(t).toMatchObject({
      externalId: `${tag}-1`,
      title: 'Portabilidad rechazada sin motivo',
      priority: 'P1',
      notes: 'nota manual',
    });
  });

  it('rejects users without import rights and unknown accounts', async () => {
    const data = { incidents: rows(uniq('EDX').replace(/\W/g, '')) };
    expect((await am.post('/imports/edo-incidents', { data, dryRun: true })).status).toBe(403);
    expect(
      (
        await cm.post('/imports/edo-incidents', {
          data,
          accountId: '00000000-0000-4000-8000-000000000000',
          dryRun: true,
        })
      ).status,
    ).toBe(404);
    expect((await cm.post('/imports/edo-incidents', { data: { wom: [] } })).status).toBe(400);
  });
});
