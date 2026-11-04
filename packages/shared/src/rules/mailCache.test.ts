import { describe, expect, it } from 'vitest';
import { LegacyMailCacheSchema } from '../schemas/dto2';
import {
  legacyTopicState,
  mapLegacyMailCache,
  matchAccountByName,
  matchTopicOpportunity,
  normalizeName,
} from './mailCache';

// Synthetic data only (no real subjects or people): see ADR 0008.
const ACCOUNTS = [
  { id: 'a-wom', name: 'WOM' },
  { id: 'a-entel', name: 'Entel' },
  { id: 'a-entel-cp', name: 'Entel Chile y Perú' },
  { id: 'a-be', name: 'BancoEstado' },
  { id: 'a-onnet', name: 'ONNET' },
  { id: 'a-acme', name: 'Acme Chile' },
];

describe('account matching', () => {
  it('normalizes accents, case and parentheses', () => {
    expect(normalizeName('Yol1 (Grupo Pronto Paga)')).toBe('yol1');
    expect(normalizeName('Entel Chile y Perú')).toBe('entel chile y peru');
  });
  it.each([
    ['WOM Chile', 'a-wom'],
    ['Entel Chile', 'a-entel-cp'],
    ['BancoEstado / Rutpay', 'a-be'],
    ['Onnet', 'a-onnet'],
  ])('%s → %s', (label, id) => {
    expect(matchAccountByName(label, ACCOUNTS).account?.id).toBe(id);
  });
  it('a shared country word alone is not a match', () => {
    expect(matchAccountByName('Santander Chile', ACCOUNTS)).toEqual({
      account: null,
      ambiguous: false,
    });
    expect(matchAccountByName('WhaleCloud (Interno)', ACCOUNTS).account).toBeNull();
  });
  it('reports ties as ambiguous and honours explicit aliases', () => {
    const accs = [
      { id: '1', name: 'Pronto' },
      { id: '2', name: 'Pronto' },
    ];
    expect(matchAccountByName('Pronto Paga', accs)).toEqual({ account: null, ambiguous: true });
    expect(
      matchAccountByName('Pronto Paga / Alipay+', ACCOUNTS, {
        'Pronto Paga / Alipay+': 'acme chile',
      }).account?.id,
    ).toBe('a-acme');
  });
});

describe('topic → opportunity (conservative)', () => {
  const opps = [
    { id: 'o1', name: 'eSIM 2.0 (Entitlement)' },
    { id: 'o2', name: 'Offer Configuration Service' },
    { id: 'o3', name: 'Support L3' },
    { id: 'o4', name: 'Support L3' },
    { id: 'o5', name: 'Dispatch' },
  ];
  it('whole-word containment with two or more tokens, unique', () => {
    expect(matchTopicOpportunity('RFP - eSIM 2.0', opps)?.id).toBe('o1');
    expect(matchTopicOpportunity('Offer Configuration Service', opps)?.id).toBe('o2');
  });
  it('no link for single-word, partial or duplicated names', () => {
    expect(matchTopicOpportunity('Dispatch Schedule', opps)).toBeNull();
    expect(matchTopicOpportunity('CR Offer Configuration', opps)).toBeNull();
    expect(matchTopicOpportunity('Support L3 emergencies', opps)).toBeNull();
  });
});

describe('legacyTopicState', () => {
  it('maps closed, resolved and hold', () => {
    expect(legacyTopicState({ closed: 'Entregado.', hold: '', status: 'Closed' })).toEqual({
      state: 'CLOSED',
      reason: 'Entregado.',
    });
    expect(legacyTopicState({ closed: '', hold: '', status: 'Resolved' }).state).toBe('CLOSED');
    expect(
      legacyTopicState({ closed: '', hold: 'Esperando presupuesto', status: 'On Hold' }),
    ).toEqual({ state: 'ON_HOLD', reason: 'Esperando presupuesto' });
    expect(legacyTopicState({ closed: '', hold: '', status: 'Stale' }).state).toBe('ACTIVE');
  });
});

const project = (p: Record<string, unknown>) => ({
  client: 'WOM Chile',
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
const RAW = {
  generated_at: '2026-11-02 15:46:54',
  window_days: 30,
  inbox_count: 50,
  sent_count: 7,
  calendar_count: 12,
  matched: 20,
  meetings_matched: 3,
  upcoming_matched: 2,
  unmatched_count: 30,
  unmatched_events: 4,
  clients: {
    'WOM Chile': {
      score: 60,
      sections: {
        Delivery: {
          projects: [
            project({
              project: 'eSIM 2.0',
              inbox: 4,
              sent: 2,
              meetings: 1,
              upcoming: 1,
              last_date: '2026-10-30T13:00:00Z',
              next_meeting: '2026-11-10T14:00:00Z',
              recent_subjects: ['[Reunion] Revisión semanal', 'Re: plan de pruebas', 'Minuta'],
              edo: [3612],
            }),
            project({
              project: 'Proyecto cerrado',
              sent: 1,
              last_date: '2026-10-20T10:00:00Z',
              closed: 'Cerrado.',
            }),
            project({ project: 'Proyecto dormido' }),
            project({ project: 'IS-1 ticket', edo: ['1'], status: 'Stale', last_days: 40 }),
          ],
        },
      },
    },
    'Cliente Nuevo SpA': {
      sections: {
        X: {
          projects: [project({ project: 'Demo', inbox: 2, last_date: '2026-10-31T10:00:00Z' })],
        },
      },
    },
  },
};

describe('mapLegacyMailCache', () => {
  const cache = LegacyMailCacheSchema.parse(RAW);
  const m = mapLegacyMailCache(cache, {
    ownerKey: 'u1',
    generatedAt: '2026-11-02T18:46:54.000Z',
    accounts: ACCOUNTS,
    opportunities: [{ id: 'o-esim', name: 'eSIM 2.0 (Entitlement)', accountId: 'a-wom' }],
  });
  it('keeps the mailbox snapshot counts', () => {
    expect(m.snapshot).toEqual({
      windowDays: 30,
      inboxCount: 50,
      sentCount: 7,
      calendarCount: 12,
      matchedCount: 20,
      meetingsMatched: 3,
      upcomingMatched: 2,
      unmatchedCount: 30,
      unmatchedEvents: 4,
    });
  });
  it('creates one topic per project (dormant ones too) and links opportunities', () => {
    expect(m.topics.map((t) => [t.name, t.state, t.opportunityId])).toEqual([
      ['eSIM 2.0', 'ACTIVE', 'o-esim'],
      ['Proyecto cerrado', 'CLOSED', null],
      ['Proyecto dormido', 'ACTIVE', null],
      ['IS-1 ticket', 'ACTIVE', null],
    ]);
    expect(m.topics[3]!.edoLastUpdateAt).toBe('2026-09-23T18:46:54.000Z');
    expect(m.topics[0]!.edoLastUpdateAt).toBeNull();
    expect(m.topics[0]!.edoRefs).toEqual(['3612']);
  });
  it('creates digest activities with counts, directions and idempotency keys', () => {
    const a = m.activities.filter((x) => x.topicKey === 'WOM Chile|Delivery|eSIM 2.0');
    expect(a.map((x) => [x.type, x.direction, x.itemCount, x.occurredAt, x.subject])).toEqual([
      ['EMAIL', 'IN', 4, '2026-10-30T13:00:00Z', 'Re: plan de pruebas'],
      ['EMAIL', 'OUT', 2, '2026-10-30T13:00:00Z', 'Re: plan de pruebas'],
      ['MEETING', null, 1, '2026-10-30T13:00:00Z', 'Revisión semanal'],
      ['MEETING', null, 1, '2026-11-10T14:00:00Z', 'eSIM 2.0'],
    ]);
    expect(a[0]!.externalKey).toBe('u1:WOM Chile|Delivery|eSIM 2.0:EMAIL_IN');
    expect(a[0]!.opportunityId).toBe('o-esim');
    expect(a[0]!.notes).toContain('Minuta');
    expect(m.activities).toHaveLength(5);
  });
  it('reports clients without an account instead of creating them', () => {
    expect(m.failures).toEqual([
      {
        row: 2,
        source: 'clients',
        code: 'CLIENT_NOT_MAPPED',
        params: { ref: 'Cliente Nuevo SpA', projects: 1, emails: 2, meetings: 0 },
      },
    ]);
    expect(m.skippedTopics).toBe(1);
  });
  it('is deterministic (same input → same keys)', () => {
    const again = mapLegacyMailCache(cache, {
      ownerKey: 'u1',
      generatedAt: '2026-11-02T18:46:54.000Z',
      accounts: ACCOUNTS,
      opportunities: [],
    });
    expect(again.activities.map((x) => x.externalKey)).toEqual(
      m.activities.map((x) => x.externalKey),
    );
  });
});
