import type { BallIn, TicketPriority, TicketStatus } from '../enums';
import { TICKET_PRIORITIES } from '../enums';
import { EDO_RECORD_FIELDS, edoRecordOf, type EdoRecord } from './edoLogic';

/**
 * eDo incidents → CRM tickets (legacy "Incidentes eDo", P10-02).
 *
 * Input: one row of `incidents[]` in the legacy dashboard file `edo_incidents.json`
 * (written by `edo_client.py normalize_item`). eDo dates come as ISO strings with the
 * +08:00 offset (China time); calendar dates are taken in the CRM time zone
 * (America/Santiago), the same way the legacy dashboard shows them.
 *
 * The natural key is the eDo `issueId` (`id`), not the ticket number: eDo reused
 * numbers WOM_IS1136…WOM_IS1147 in 2021 and 2022, so two different tickets can share `no`.
 */

/** Statuses of the eDo process (FINDINGS.md): 0 New … 5 Closed. */
export const EDO_STATUS_MAP: Record<number, TicketStatus> = {
  0: 'OPEN', // New
  1: 'OPEN', // Assigned
  2: 'IN_PROGRESS', // Diagnosing
  3: 'IN_PROGRESS', // In Progress
  4: 'RESOLVED', // "Resloved" (sic in eDo)
  5: 'CLOSED',
};

/** Fields of the legacy row the importer reads; the web client sends only these. */
export const EDO_IMPORT_FIELDS = EDO_RECORD_FIELDS;

export const EDO_TICKET_URL = 'https://edo.iwhalecloud.com?issueId=';

export interface EdoTicketDraft {
  externalId: string;
  number: string;
  title: string;
  priority: TicketPriority;
  status: TicketStatus;
  ballIn: BallIn;
  orgHolder: string | null;
  ownerName: string | null;
  slaDueOn: string | null;
  openedOn: string;
  /** ISO instant (UTC). */
  lastUpdateAt: string;
  closedOn: string | null;
  externalUrl: string;
  /** Normalized eDo row (SLA limits, first response, assignee…) for the legacy KPIs. */
  edo: EdoRecord;
}

export interface EdoMapIssue {
  /** 1-based position in `incidents[]`. */
  row: number;
  code: string;
  params?: Record<string, unknown>;
}

export interface EdoMapResult {
  tickets: EdoTicketDraft[];
  /** Rows that cannot be imported. */
  failures: EdoMapIssue[];
  /** Rows imported with an assumption (e.g. unknown priority → P3). */
  warnings: EdoMapIssue[];
  /** Same `id` repeated in the file (the first one wins). */
  duplicates: number;
}

export interface EdoMapOptions {
  /** IANA zone for calendar dates (APP_TIMEZONE). */
  timeZone: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** eDo ISO date (with offset) or epoch ms → Date; null when empty or invalid. */
export function parseEdoInstant(v: unknown): Date | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
    return new Date(v > 1e11 ? v : v * 1000);
  }
  const s = str(v);
  if (!s) return null;
  // A string without zone is eDo raw time: China (UTC+8).
  const iso = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$/.test(s)
    ? `${s.replace(' ', 'T')}${s.length === 10 ? 'T00:00:00' : ''}+08:00`
    : s;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Calendar date (YYYY-MM-DD) of an instant in a time zone. */
export function dateInZone(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** eDo status code (or its name) → CRM ticket status; null when unknown. */
export function edoTicketStatus(status: unknown, statusName?: unknown): TicketStatus | null {
  const n = typeof status === 'number' ? status : Number(str(status) || NaN);
  if (Number.isInteger(n) && n in EDO_STATUS_MAP) return EDO_STATUS_MAP[n]!;
  const name = str(statusName).toLowerCase();
  if (!name) return null;
  if (/^(new|assigned|open)/.test(name)) return 'OPEN';
  if (/^(diagnos|in progress|processing)/.test(name)) return 'IN_PROGRESS';
  if (/^(resolved|resloved)/.test(name)) return 'RESOLVED';
  if (/^(closed|cancel|reject)/.test(name)) return 'CLOSED';
  return null;
}

/**
 * "Pelota en": who must act. The org that holds the ticket in eDo; `WOM` means the
 * client, any other team (WhaleCloudSupport, WHNOC OSS Team…) means Whale.
 */
export function edoBallIn(side: unknown, org: unknown): BallIn {
  const s = str(side).toUpperCase();
  if (s === 'WOM') return 'CLIENT';
  if (s === 'WHALE') return 'WHALE';
  return str(org).toUpperCase() === 'WOM' ? 'CLIENT' : 'WHALE';
}

const OPEN_STATUSES: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'PENDING_CLIENT'];

type Mapped = { ok: true; draft: EdoTicketDraft; warnings: EdoMapIssue[] } | EdoMapIssue;

/** Maps one row of `edo_incidents.json`. `row` is used in the issues it reports. */
export function mapEdoIncident(
  r: Record<string, unknown>,
  row: number,
  opts: EdoMapOptions,
): Mapped {
  const externalId = str(r.id);
  if (!externalId) return { row, code: 'EDO_ID_MISSING' };
  const number = str(r.no) || externalId;
  const created = parseEdoInstant(r.created);
  if (!created) return { row, code: 'EDO_CREATED_MISSING', params: { number } };
  const warnings: EdoMapIssue[] = [];

  let status = edoTicketStatus(r.status, r.statusName);
  if (!status) {
    if (typeof r.open !== 'boolean')
      return { row, code: 'EDO_STATUS_UNKNOWN', params: { number, status: r.status ?? null } };
    status = r.open ? 'OPEN' : 'CLOSED';
    warnings.push({
      row,
      code: 'EDO_STATUS_ASSUMED',
      params: { number, status: r.statusName ?? r.status ?? null, as: status },
    });
  }

  const p = str(r.priority).toUpperCase();
  let priority = (TICKET_PRIORITIES as readonly string[]).includes(p)
    ? (p as TicketPriority)
    : null;
  if (!priority) {
    priority = 'P3';
    warnings.push({
      row,
      code: 'EDO_PRIORITY_ASSUMED',
      params: { number, priority: r.priority ?? null, as: 'P3' },
    });
  }

  const updated = parseEdoInstant(r.updated) ?? created;
  const isOpen = OPEN_STATUSES.includes(status);
  // End of "open" as in the legacy closeMs/endMs: closedDate, then resolution, then last update.
  const end = isOpen ? null : (parseEdoInstant(r.closed) ?? parseEdoInstant(r.resolved) ?? updated);
  const sla = parseEdoInstant(r.resSlaLimit);
  const link = str(r.link);

  return {
    ok: true,
    warnings,
    draft: {
      externalId,
      number,
      title: str(r.title) || number,
      priority,
      status,
      ballIn: edoBallIn(r.side, r.org),
      orgHolder: str(r.org) || null,
      ownerName: str(r.assignee) || null,
      slaDueOn: sla ? dateInZone(sla, opts.timeZone) : null,
      openedOn: dateInZone(created, opts.timeZone),
      lastUpdateAt: updated.toISOString(),
      closedOn: end ? dateInZone(end, opts.timeZone) : null,
      externalUrl: link.startsWith(EDO_TICKET_URL)
        ? link
        : `${EDO_TICKET_URL}${encodeURIComponent(externalId)}`,
      edo: edoRecordOf(r),
    },
  };
}

/** Maps the whole `incidents[]` array; repeated ids keep the first occurrence. */
export function mapEdoIncidents(
  rows: readonly Record<string, unknown>[],
  opts: EdoMapOptions,
): EdoMapResult {
  const out: EdoMapResult = { tickets: [], failures: [], warnings: [], duplicates: 0 };
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    const m = mapEdoIncident(r, i + 1, opts);
    if (!('ok' in m)) {
      out.failures.push(m);
      return;
    }
    if (seen.has(m.draft.externalId)) {
      out.duplicates++;
      return;
    }
    seen.add(m.draft.externalId);
    out.tickets.push(m.draft);
    out.warnings.push(...m.warnings);
  });
  return out;
}

/** Fields compared to decide whether an existing ticket changed in eDo. */
export const EDO_SYNCED_FIELDS = [
  'number',
  'title',
  'priority',
  'status',
  'ballIn',
  'orgHolder',
  'ownerName',
  'slaDueOn',
  'openedOn',
  'lastUpdateAt',
  'closedOn',
  'externalUrl',
  'edo',
] as const;

/** JSON with sorted keys: Postgres jsonb does not keep the key order. */
function stableJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
    .join(',')}}`;
}

/** Synced fields that differ between the stored ticket and the eDo draft. */
export function edoChangedFields(
  current: Partial<Record<(typeof EDO_SYNCED_FIELDS)[number], unknown>>,
  draft: EdoTicketDraft,
): string[] {
  const norm = (k: string, v: unknown) => {
    if (v === undefined || v === null) return null;
    if (k === 'lastUpdateAt') return new Date(v as string | Date).toISOString();
    if (k === 'edo') return stableJson(v);
    return String(v);
  };
  return EDO_SYNCED_FIELDS.filter((k) => norm(k, current[k]) !== norm(k, draft[k]));
}

/** Keeps only the fields the importer reads (shrinks the 4 MB file before upload). */
export function slimEdoIncidents(rows: readonly Record<string, unknown>[]) {
  return rows.map((r) => edoRecordOf(r) as unknown as Record<string, unknown>);
}

/** Accepts the legacy file (`{ incidents: [...] }`) or a bare array. */
export function edoIncidentRows(data: unknown): Record<string, unknown>[] | null {
  const list = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as { incidents?: unknown }).incidents)
      ? (data as { incidents: unknown[] }).incidents
      : null;
  if (!list) return null;
  return list.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object');
}
