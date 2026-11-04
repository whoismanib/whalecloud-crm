import { describe, expect, it } from 'vitest';
import sample from './__fixtures__/edo_incidents.sample.json';
import {
  dateInZone,
  edoBallIn,
  edoChangedFields,
  edoIncidentRows,
  edoTicketStatus,
  mapEdoIncident,
  mapEdoIncidents,
  parseEdoInstant,
  slimEdoIncidents,
  type EdoTicketDraft,
} from './edoIncidents';

const TZ = { timeZone: 'America/Santiago' };
const rows = sample.incidents as Record<string, unknown>[];
const byNo = (no: string) => rows.find((r) => r.no === no)!;
const draftOf = (r: Record<string, unknown>) => {
  const m = mapEdoIncident(r, 1, TZ);
  if (!('ok' in m)) throw new Error(m.code);
  return m;
};

describe('eDo incidents → tickets (legacy edo_incidents.json)', () => {
  it('imports the legacy fixture with the same open counts as the legacy dashboard', () => {
    const r = mapEdoIncidents(rows, TZ);
    expect(r.failures).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.tickets).toHaveLength(sample.counts.total);
    const open = r.tickets.filter((t) => ['OPEN', 'IN_PROGRESS'].includes(t.status));
    expect(open).toHaveLength(sample.counts.open);
    // Same split as the legacy "Abiertos en Whale / en WOM" (side of the fixture rows).
    const legacyOpen = rows.filter((x) => x.open === true);
    expect(open.filter((t) => t.ballIn === 'WHALE')).toHaveLength(
      legacyOpen.filter((x) => x.side === 'Whale').length,
    );
    expect(open.filter((t) => t.ballIn === 'CLIENT')).toHaveLength(
      legacyOpen.filter((x) => x.side === 'WOM').length,
    );
    expect(r.tickets.filter((t) => t.status === 'RESOLVED')).toHaveLength(sample.counts.resolved);
    expect(r.tickets.filter((t) => t.status === 'CLOSED')).toHaveLength(sample.counts.closed);
  });

  it('maps an open ticket held by Whale (eDo dates are UTC+8, calendar dates in Chile)', () => {
    const m = draftOf(byNo('WOM_IS3700'));
    expect(m.warnings).toEqual([]);
    expect(m.draft).toEqual<EdoTicketDraft>({
      externalId: 'IS2637002051802512',
      number: 'WOM_IS3700',
      title: 'Portabilidad rechazada sin motivo (3700)',
      priority: 'P1',
      status: 'OPEN',
      ballIn: 'WHALE',
      orgHolder: 'WhaleCloudSupport',
      ownerName: 'Li Wei',
      slaDueOn: '2026-10-29',
      openedOn: '2026-10-28',
      lastUpdateAt: '2026-10-28T17:04:56.000Z',
      closedOn: null,
      externalUrl: 'https://edo.iwhalecloud.com?issueId=IS2637002051802512',
    });
  });

  it('takes the calendar date in Chile, not in China', () => {
    // 2026-10-28 05:53 in China = 2026-10-27 18:53 in Santiago (UTC-3).
    const d = draftOf(byNo('WOM_IS3704')).draft;
    expect(d.openedOn).toBe('2026-10-27');
    expect(d.status).toBe('IN_PROGRESS'); // Diagnosing
    expect(d.ballIn).toBe('CLIENT'); // "pelota en" WOM
    expect(d.slaDueOn).toBeNull();
    expect(d.ownerName).toBe('Diego Munoz');
  });

  it('maps resolved and closed tickets with their end date', () => {
    const resolved = draftOf(byNo('WOM_IS3726')).draft;
    expect(resolved).toMatchObject({ status: 'RESOLVED', closedOn: '2026-10-24' });
    const closed = draftOf(byNo('WOM_IS3730')).draft;
    // closedDate 2026-09-30 01:18 China = 2026-09-29 14:18 Chile.
    expect(closed).toMatchObject({ status: 'CLOSED', closedOn: '2026-09-29', ballIn: 'WHALE' });
    expect(closed.orgHolder).toBe('WHNOC OSS Team');
  });

  it('falls back when eDo leaves fields empty', () => {
    const m = draftOf({
      id: 'ISX1',
      no: '',
      title: '  ',
      priority: null,
      status: 5,
      open: false,
      org: '',
      side: '',
      assignee: '',
      created: '2021-09-03T03:35:20+08:00',
      updated: null,
      resolved: null,
      closed: null,
      resSlaLimit: null,
      link: '',
    });
    expect(m.draft).toMatchObject({
      number: 'ISX1',
      title: 'ISX1',
      priority: 'P3',
      ballIn: 'WHALE',
      orgHolder: null,
      ownerName: null,
      openedOn: '2021-09-02',
      lastUpdateAt: '2021-09-02T19:35:20.000Z',
      closedOn: '2021-09-02', // no closed/resolved/updated → created
      externalUrl: 'https://edo.iwhalecloud.com?issueId=ISX1',
    });
    expect(m.warnings).toEqual([
      {
        row: 1,
        code: 'EDO_PRIORITY_ASSUMED',
        params: { number: 'ISX1', priority: null, as: 'P3' },
      },
    ]);
  });

  it('reports rows that cannot be imported, and keeps the first of a repeated id', () => {
    const base = byNo('WOM_IS3700');
    const r = mapEdoIncidents(
      [
        base,
        { ...base, title: 'repetido' },
        { ...base, id: '' },
        { ...base, id: 'ISX2', created: 'no es fecha' },
        { ...base, id: 'ISX3', status: 9, statusName: 'Raro', open: undefined },
        { ...base, id: 'ISX4', status: 9, statusName: 'Suspended', open: true },
      ],
      TZ,
    );
    expect(r.duplicates).toBe(1);
    expect(r.tickets.map((t) => t.externalId)).toEqual(['IS2637002051802512', 'ISX4']);
    expect(r.tickets[0]!.title).toBe(base.title);
    expect(r.failures).toEqual([
      { row: 3, code: 'EDO_ID_MISSING' },
      { row: 4, code: 'EDO_CREATED_MISSING', params: { number: 'WOM_IS3700' } },
      { row: 5, code: 'EDO_STATUS_UNKNOWN', params: { number: 'WOM_IS3700', status: 9 } },
    ]);
    expect(r.warnings).toEqual([
      {
        row: 6,
        code: 'EDO_STATUS_ASSUMED',
        params: { number: 'WOM_IS3700', status: 'Suspended', as: 'OPEN' },
      },
    ]);
  });

  it('two tickets with the same eDo number (reused in 2021/2022) are kept apart by id', () => {
    const a = { ...byNo('WOM_IS3730'), id: 'IS2109030335220961', no: 'WOM_IS1147' };
    const b = { ...byNo('WOM_IS3731'), id: 'IS2204280321179466', no: 'WOM_IS1147' };
    const r = mapEdoIncidents([a, b], TZ);
    expect(r.tickets.map((t) => [t.number, t.externalId])).toEqual([
      ['WOM_IS1147', 'IS2109030335220961'],
      ['WOM_IS1147', 'IS2204280321179466'],
    ]);
    expect(r.duplicates).toBe(0);
  });

  it('status codes and names', () => {
    expect([0, 1, 2, 3, 4, 5].map((s) => edoTicketStatus(s))).toEqual([
      'OPEN',
      'OPEN',
      'IN_PROGRESS',
      'IN_PROGRESS',
      'RESOLVED',
      'CLOSED',
    ]);
    expect(edoTicketStatus('4')).toBe('RESOLVED');
    expect(edoTicketStatus(null, 'Assigned')).toBe('OPEN');
    expect(edoTicketStatus(undefined, 'In Progress')).toBe('IN_PROGRESS');
    expect(edoTicketStatus(undefined, 'Resloved')).toBe('RESOLVED');
    expect(edoTicketStatus(undefined, 'Resolved')).toBe('RESOLVED');
    expect(edoTicketStatus(7, 'Cancelled')).toBe('CLOSED');
    expect(edoTicketStatus(7, 'Otro')).toBeNull();
    expect(edoTicketStatus(undefined, '')).toBeNull();
  });

  it('"pelota en": WOM is the client, any other team is Whale', () => {
    expect(edoBallIn('WOM', 'WOM')).toBe('CLIENT');
    expect(edoBallIn('Whale', 'WhaleCloudSupport')).toBe('WHALE');
    expect(edoBallIn('', ' wom ')).toBe('CLIENT');
    expect(edoBallIn(undefined, 'WHNOC OSS Team')).toBe('WHALE');
    expect(edoBallIn(null, null)).toBe('WHALE');
  });

  it('parses eDo instants (ISO with offset, raw China time, epoch)', () => {
    expect(parseEdoInstant('2026-10-29 02:04:29')!.toISOString()).toBe('2026-10-28T18:04:29.000Z');
    expect(parseEdoInstant('2026-10-29')!.toISOString()).toBe('2026-10-28T16:00:00.000Z');
    expect(parseEdoInstant(1793808583796)!.toISOString()).toBe('2026-11-04T16:09:43.796Z');
    expect(parseEdoInstant(1793808583)!.getTime()).toBe(1793808583000);
    expect(parseEdoInstant(0)).toBeNull();
    expect(parseEdoInstant('')).toBeNull();
    expect(parseEdoInstant('x')).toBeNull();
    expect(dateInZone(new Date('2026-11-04T02:00:00Z'), 'America/Santiago')).toBe('2026-11-03');
  });

  it('detects changed fields for the idempotent upsert', () => {
    const d = draftOf(byNo('WOM_IS3700')).draft;
    const stored = { ...d, lastUpdateAt: new Date(d.lastUpdateAt) as unknown as string };
    expect(edoChangedFields(stored, d)).toEqual([]);
    expect(edoChangedFields({ ...stored, status: 'CLOSED', slaDueOn: undefined }, d)).toEqual([
      'status',
      'slaDueOn',
    ]);
  });

  it('accepts the legacy file or a bare array, and slims rows before upload', () => {
    expect(edoIncidentRows(sample)).toHaveLength(sample.counts.total);
    expect(edoIncidentRows([{ id: 'a' }, null, 3])).toEqual([{ id: 'a' }]);
    expect(edoIncidentRows({ wom: [] })).toBeNull();
    expect(edoIncidentRows(null)).toBeNull();
    const slim = slimEdoIncidents([{ id: 'a', comment: 'largo', assigneeRaw: '[x]1', no: 'N' }]);
    expect(slim).toEqual([{ id: 'a', no: 'N' }]);
  });
});
