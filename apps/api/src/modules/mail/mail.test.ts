import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { as, client, createTestApp, uniq } from '../../../test/helpers';
import { createOpportunity, okData, type ApiClient } from '../../db/seed/flows';
import { localToUtc, ticketMatchesRef } from './service';

// ADR 0008 phase 0. Synthetic cache: no real subjects, people or mailboxes.
let app: FastifyInstance;
let cm: ApiClient;
let am: ApiClient;
let am2: ApiClient;
let accountName: string;
let accountId: string;
let oppId: string;

const project = (p: Record<string, unknown>) => ({
  section: 'Delivery',
  inbox: 0,
  sent: 0,
  meetings: 0,
  upcoming: 0,
  last_date: null,
  next_meeting: null,
  recent_subjects: [],
  hold: '',
  closed: '',
  edo: [],
  status: '',
  seen_date: null,
  ...p,
});

function cache(generatedAt: string, inbox = 4) {
  return {
    generated_at: generatedAt,
    window_days: 30,
    inbox_count: 40,
    sent_count: 6,
    calendar_count: 9,
    matched: 10,
    meetings_matched: 3,
    upcoming_matched: 2,
    unmatched_count: 30,
    unmatched_events: 1,
    clients: {
      [`${accountName} Chile`]: {
        sections: {
          Delivery: {
            projects: [
              project({
                project: 'Plataforma Mail Sync',
                inbox,
                sent: 2,
                meetings: 1,
                upcoming: 1,
                last_date: '2026-11-02T13:00:00Z',
                next_meeting: '2026-11-10T14:00:00Z',
                recent_subjects: ['[Reunion] Revisión', 'Re: avance'],
              }),
              project({ project: 'Solo entrada', inbox: 3, last_date: '2026-10-15T10:00:00Z' }),
              project({
                project: 'En pausa',
                inbox: 1,
                last_date: '2026-11-01T10:00:00Z',
                hold: 'x',
              }),
              project({ project: 'Dormido' }),
            ],
          },
        },
      },
      'Cliente Sin Cuenta': {
        sections: {
          X: { projects: [project({ project: 'Y', inbox: 1, last_date: '2026-11-01T10:00:00Z' })] },
        },
      },
    },
  };
}

beforeAll(async () => {
  app = await createTestApp();
  cm = client(app, await as(app, ['COUNTRY_MANAGER']));
  am = client(app, await as(app, ['ACCOUNT_MANAGER']));
  am2 = client(app, await as(app, ['ACCOUNT_MANAGER']));
  const be = (await okData(cm.get('/catalogs'))).billingEntities[0].id;
  accountName = uniq('Mailco');
  accountId = (
    await okData(
      cm.post('/accounts', {
        name: accountName,
        countryCode: 'CL',
        vertical: 'TELECOM_BSS',
        customerType: 'EXISTING',
        defaultBillingEntityId: be,
        currency: 'USD',
      }),
    )
  ).id;
  oppId = (
    await createOpportunity(cm, {
      accountId,
      name: 'Plataforma Mail Sync',
      vertical: 'TELECOM_BSS',
      engine: 'B',
      amount: '10000',
      close: '2027-03-31',
      firstContact: '2026-10-01',
      contact: { firstName: 'Ana', lastName: 'Prueba', jobTitle: 'CTO', roles: ['CHAMPION'] },
    })
  ).oppId;
});
afterAll(async () => {
  await app.close();
});

describe('helpers', () => {
  it('converts the Mac local time of generated_at to UTC', () => {
    expect(localToUtc('2026-11-02 15:46:54', 'America/Santiago').toISOString()).toBe(
      '2026-11-02T18:46:54.000Z',
    );
    expect(localToUtc('2026-07-02 15:00:00', 'America/Santiago').toISOString()).toBe(
      '2026-07-02T19:00:00.000Z',
    );
    expect(localToUtc('2026-11-02T15:00:00Z', 'America/Santiago').toISOString()).toBe(
      '2026-11-02T15:00:00.000Z',
    );
  });
  it('matches eDo refs against ticket numbers', () => {
    expect(ticketMatchesRef('WOM_IS3676', '3676')).toBe(true);
    expect(ticketMatchesRef('IS-3676', '3676')).toBe(true);
    expect(ticketMatchesRef('WOM_IS13676', '3676')).toBe(false);
  });
});

describe('POST /mail/legacy-cache (ADR 0008 phase 0)', () => {
  it('dry run reports and persists nothing', async () => {
    const r = await okData(
      am.post('/mail/legacy-cache', { data: cache('2026-11-02 15:46:54'), dryRun: true }),
    );
    expect(r).toMatchObject({
      dryRun: true,
      rowsTotal: 5,
      rowsOk: 4,
      skipped: 1,
      linkedOpportunities: 1,
      created: { topics: 4, activities: 6, emails: 10, meetings: 1, snapshots: 1 },
    });
    expect(r.errors).toEqual([
      expect.objectContaining({
        code: 'CLIENT_NOT_MAPPED',
        params: expect.objectContaining({ ref: 'Cliente Sin Cuenta' }),
      }),
    ]);
    const e = await okData(am.get('/dashboard/engagement'));
    expect(e.accounts).toEqual([]);
    expect(e.mailbox).toBeNull();
  });

  it('imports topics, digest activities and the snapshot; same cache again is a no-op', async () => {
    const r = await okData(am.post('/mail/legacy-cache', { data: cache('2026-11-02 15:46:54') }));
    expect(r.created).toMatchObject({ topics: 4, activities: 6 });
    const again = await okData(
      am.post('/mail/legacy-cache', { data: cache('2026-11-02 15:46:54') }),
    );
    expect(again).toMatchObject({ created: {}, skipped: 5 });

    const acts = await okData(am.get(`/activities?accountId=${accountId}`));
    expect(acts).toHaveLength(6);
    expect(acts.every((a: { source: string }) => a.source === 'LEGACY_MAIL_CACHE')).toBe(true);
    const inbound = acts.find(
      (a: { direction: string; subject: string }) =>
        a.direction === 'IN' && a.subject === 'Re: avance',
    );
    expect(inbound).toMatchObject({ itemCount: 4, opportunityId: oppId, type: 'EMAIL' });

    const e = await okData(am.get('/dashboard/engagement'));
    expect(e.mailbox).toMatchObject({ emails: 46, meetings: 3, upcoming: 2, unmatched: 30 });
    expect(e.accounts).toHaveLength(1);
    const acc = e.accounts[0];
    // today = 2026-11-04: main topic 2 days → 40 + 27 + 30 = 97; "Solo entrada" ~20 days → stale 35.
    expect(acc).toMatchObject({
      accountId,
      activeCount: 2,
      totalCount: 4,
      emails: 10,
      meetings: 1,
      upcoming: 1,
      onHold: 1,
      score: 66,
    });
    expect(e.summary).toMatchObject({ active: 2, healthy: 1, critical: 1, stale: 1, onHold: 1 });
    // Other users do not see this mailbox.
    expect((await okData(am2.get('/dashboard/engagement'))).accounts).toEqual([]);
  });

  it('opportunity health uses the 30-day counts', async () => {
    const h = await okData(cm.get('/dashboard/health'));
    const row = h.find((x: { id: string }) => x.id === oppId);
    expect(row).toMatchObject({ emails30d: 6, meetings30d: 1, upcomingMeetings: 1 });
    expect(row.reasons.map((x: { code: string }) => x.code)).toContain('MEETING_30D');
  });

  it('a newer cache replaces the digests; an older one is rejected', async () => {
    const r = await okData(
      am.post('/mail/legacy-cache', { data: cache('2026-11-03 09:00:00', 1) }),
    );
    expect(r.replacedActivities).toBe(6);
    const acts = await okData(am.get(`/activities?accountId=${accountId}`));
    expect(acts).toHaveLength(6);
    expect(
      acts.reduce(
        (a: number, x: { type: string; itemCount: number }) =>
          a + (x.type === 'EMAIL' ? x.itemCount : 0),
        0,
      ),
    ).toBe(7);
    const old = await am.post('/mail/legacy-cache', { data: cache('2026-11-01 09:00:00') });
    expect(old.status).toBe(409);
    expect(old.body.code).toBe('MAIL_CACHE_OLDER');
  });

  it('only admins import on behalf of another user; country managers may read all mailboxes', async () => {
    const other = await am.post('/mail/legacy-cache', {
      data: cache('2026-11-03 10:00:00'),
      userId: '00000000-0000-4000-8000-000000000001',
      dryRun: true,
    });
    expect(other.status).toBe(403);
    const all = await okData(cm.get('/dashboard/engagement?scope=all'));
    expect(all.scope).toBe('all');
    expect(all.accounts.some((a: { accountId: string }) => a.accountId === accountId)).toBe(true);
    expect((await okData(am.get('/dashboard/engagement?scope=all'))).scope).toBe('mine');
  });

  it('validates the payload', async () => {
    const bad = await am.post('/mail/legacy-cache', { data: { clients: {} } });
    expect(bad.status).toBe(400);
  });
});
