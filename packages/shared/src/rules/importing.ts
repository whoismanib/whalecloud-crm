import { D, money, type RuleFailure } from './common';
import { legacyStatusToStage } from './legacyStatus';
import { quarterRange } from './forecast';
import {
  LEGACY_STATUSES,
  type LegacyStatus,
  type OpportunityStatus,
  type RiskLevel,
} from '../enums';

// ---------- CSV ----------

/** RFC 4180 CSV parser; delimiter auto-detected (`;` common in Chilean Excel, else `,`). */
export function parseCsv(text: string, delimiter?: string): Record<string, string>[] {
  const src = text.replace(/^\uFEFF/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const delim =
    delimiter ??
    ((firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ''));
  const [header, ...body] = nonEmpty;
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

/**
 * CWE-1236: a text cell starting with = + - @, tab or CR is prefixed with `'` so spreadsheet apps
 * show it as text instead of evaluating it. Plain numbers ("-12.50") are left as they are.
 */
export function neutralizeFormula<T>(v: T): T | string {
  if (typeof v !== 'string') return v;
  if (/^-?\d+(\.\d+)?$/.test(v)) return v;
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = neutralizeFormula(typeof v === 'object' ? JSON.stringify(v) : String(v));
  return /[",;\n\r\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV writer (comma, CRLF, UTF-8 BOM for Excel). */
export function toCsv(
  rows: ReadonlyArray<Record<string, unknown>>,
  columns: readonly string[],
): string {
  const lines = [
    columns.join(','),
    ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(',')),
  ];
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/** Accepts YYYY-MM-DD(…), DD/MM/YYYY or DD-MM-YYYY; null when empty/invalid. */
export function parseLooseDate(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  return null;
}

/** "Q3 2026", "2026Q3", "Q3-2026" → last day of the quarter. */
export function quarterEnd(v: string | null | undefined): string | null {
  if (!v) return null;
  const s = String(v).toUpperCase().replace(/\s+/g, '');
  const m = /^Q([1-4])-?(\d{4})$/.exec(s) ?? /^(\d{4})-?Q([1-4])$/.exec(s);
  if (!m) return null;
  const [y, q] = /^Q/.test(s) ? [m[2]!, m[1]!] : [m[1]!, m[2]!];
  return quarterRange(`${y}Q${q}`).to;
}

export function parseAmount(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? money(v) : null;
  let s = String(v).replace(/[^\d.,-]/g, '');
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (!s.includes(',') && (s.match(/\./g)?.length ?? 0) > 1) s = s.replace(/\./g, '');
  else s = s.replace(/,/g, '');
  return /^-?\d+(\.\d+)?$/.test(s) ? money(s) : null;
}

// ---------- legacy tracker (tracker_data.json) ----------

export interface LegacyTrackerData {
  wom?: Record<string, unknown>[];
  new_clients?: Record<string, unknown>[];
  billing?: Record<string, unknown>[];
}

export interface LegacyOpportunityDraft {
  source: 'wom' | 'new_clients';
  row: number;
  accountName: string;
  customerType: 'EXISTING' | 'NEW';
  name: string;
  stage: number;
  status: OpportunityStatus;
  legacyStatus: string | null;
  risk: RiskLevel | null;
  amountUsd: string;
  poNumber: string | null;
  poAmountUsd: string | null;
  expectedCloseDate: string;
  billingEngine: 'A' | 'B';
  ownerName: string | null;
  nextAction: string | null;
  competitor: string | null;
}

export interface LegacyInvoiceDraft {
  row: number;
  projectName: string;
  receptionOn: string | null;
  amountUsd: string;
  invoiceNumber: string | null;
  issuedOn: string | null;
  dueOn: string | null;
  payStatus: 'NOT_INVOICED' | 'PENDING' | 'PAID';
}

const str = (v: unknown): string | null =>
  v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim();
const RISK: Record<string, RiskLevel> = { low: 'LOW', medium: 'MEDIUM', high: 'HIGH' };

function mapStatus(raw: string | null): {
  stage: number;
  status: OpportunityStatus;
  legacy: string | null;
} {
  if (!raw) return { stage: 1, status: 'OPEN', legacy: null };
  const known = LEGACY_STATUSES.find((s) => s.toLowerCase() === raw.toLowerCase());
  if (known) {
    const m = legacyStatusToStage(known as LegacyStatus);
    return { stage: m.stage ?? 3, status: m.status, legacy: known };
  }
  if (/^(lost|perdid)/i.test(raw)) return { stage: 1, status: 'LOST', legacy: raw };
  return { stage: 1, status: 'OPEN', legacy: raw };
}

/**
 * Maps the legacy tracker JSON (keys wom[], new_clients[], billing[] — tracker_app.py) to CRM
 * drafts, using the legacy status → stage mapping (LEGACY-DASHBOARD.md). Pure: persistence is
 * done by the API importer.
 */
export function mapLegacyTracker(
  data: LegacyTrackerData,
  opts: { importDate: string },
): {
  opportunities: LegacyOpportunityDraft[];
  invoices: LegacyInvoiceDraft[];
  failures: (RuleFailure & { row: number; source: string })[];
} {
  const failures: (RuleFailure & { row: number; source: string })[] = [];
  const defaultClose = `${opts.importDate.slice(0, 4)}-12-31`;
  const opportunities: LegacyOpportunityDraft[] = [];
  (data.wom ?? []).forEach((r, i) => {
    const name = str(r.name);
    if (!name) {
      failures.push({
        code: 'FIELD_REQUIRED',
        params: { field: 'name' },
        row: i + 1,
        source: 'wom',
      });
      return;
    }
    const st = mapStatus(str(r.status));
    const expected = parseAmount(r.expected) ?? '0.00';
    const poNet = parseAmount(r.po_net);
    opportunities.push({
      source: 'wom',
      row: i + 1,
      accountName: 'WOM',
      customerType: 'EXISTING',
      name,
      stage: st.stage,
      status: st.status,
      legacyStatus: st.legacy,
      risk: RISK[String(r.risk ?? '').toLowerCase()] ?? null,
      amountUsd: poNet && D(poNet).gt(0) ? poNet : expected,
      poNumber: str(r.po),
      poAmountUsd: poNet && D(poNet).gt(0) ? poNet : null,
      expectedCloseDate: parseLooseDate(str(r.delivery)) ?? defaultClose,
      billingEngine: /\bCR\b|change request/i.test(name) ? 'B' : 'A',
      ownerName: str(r.pic),
      nextAction: str(r.next),
      competitor: null,
    });
  });
  (data.new_clients ?? []).forEach((r, i) => {
    const name = str(r.name);
    const client = str(r.client);
    if (!name || !client) {
      failures.push({
        code: 'FIELD_REQUIRED',
        params: { field: name ? 'client' : 'name' },
        row: i + 1,
        source: 'new_clients',
      });
      return;
    }
    const st = mapStatus(str(r.status));
    opportunities.push({
      source: 'new_clients',
      row: i + 1,
      accountName: client,
      customerType: 'NEW',
      name,
      stage: Math.min(st.stage, 6),
      status: st.status,
      legacyStatus: st.legacy,
      risk: RISK[String(r.risk ?? '').toLowerCase()] ?? null,
      amountUsd: parseAmount(r.expected) ?? '0.00',
      poNumber: null,
      poAmountUsd: null,
      expectedCloseDate: quarterEnd(str(r.quarter)) ?? defaultClose,
      billingEngine: 'A',
      ownerName: str(r.pic),
      nextAction: str(r.next),
      competitor: str(r.competition),
    });
  });
  const invoices: LegacyInvoiceDraft[] = [];
  (data.billing ?? []).forEach((r, i) => {
    const name = str(r.name);
    const amount = parseAmount(r.usd);
    if (!name || !amount || D(amount).lte(0)) {
      failures.push({
        code: 'FIELD_REQUIRED',
        params: { field: name ? 'usd' : 'name' },
        row: i + 1,
        source: 'billing',
      });
      return;
    }
    const s = String(r.status ?? '').toLowerCase();
    invoices.push({
      row: i + 1,
      projectName: name,
      receptionOn: parseLooseDate(str(r.reception)),
      amountUsd: amount,
      invoiceNumber: str(r.invoice_no),
      issuedOn: parseLooseDate(str(r.invoice_date)),
      dueOn: parseLooseDate(str(r.due)),
      payStatus: s === 'paid' ? 'PAID' : s === 'pending' ? 'PENDING' : 'NOT_INVOICED',
    });
  });
  return { opportunities, invoices, failures };
}
