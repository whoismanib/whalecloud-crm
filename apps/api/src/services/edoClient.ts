/**
 * Read-only eDo Open API client (ADR 0007): the same queries as the legacy `edo_client.py`.
 *
 * - Only `POST /dmpp/open/api/business/queryIssueByCondition`, with `Authorization: Bearer`.
 * - The token comes from the environment (`EDO_ACCESS_TOKEN`) and never leaves this module: it is
 *   not stored, logged or returned. Redirects are not followed (they would resend the Bearer).
 * - Pages of 100 in three status groups (open 0–3, resolved 4, closed 5), 4 pages in parallel.
 *   Closed tickets stop after the last 100 days unless a ticket that was open before is older
 *   (it may have just closed): older closed tickets stay in the CRM as they were.
 */
import { readFile } from 'node:fs/promises';

export class EdoError extends Error {
  constructor(
    readonly code: 'no_token' | 'auth' | 'network' | 'bad_response',
    message: string,
  ) {
    super(message);
  }
}

export interface EdoClientConfig {
  token?: string;
  baseUrl: string;
  projectId: string;
  issueType: string;
  fixture?: string;
}

export type EdoProgress = (done: number, total: number, label: string) => void;

const QUERY_PATH = '/dmpp/open/api/business/queryIssueByCondition';
const PAGE_SIZE = 100;
const TIMEOUT_MS = 30_000;
const WORKERS = 4;
const QUICK_CLOSED_DAYS = 100;
const STATUS_GROUPS: [string, number[]][] = [
  ['abiertos', [0, 1, 2, 3]],
  ['resueltos', [4]],
  ['cerrados', [5]],
];
const TERMINAL = new Set([4, 5]);
const COMMENT_MAX = 2000;

type Raw = Record<string, unknown>;
interface Page {
  total: number;
  list: Raw[];
}

async function post(cfg: EdoClientConfig, token: string, body: unknown): Promise<Page> {
  let last: EdoError | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetch(cfg.baseUrl + QUERY_PATH, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      last = new EdoError('network', `eDo no responde (${(e as Error).name}).`);
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    if (res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400))
      throw new EdoError('auth', `eDo rechazó el token (HTTP ${res.status}). Puede estar vencido.`);
    if (!res.ok) {
      last = new EdoError('network', `eDo respondió HTTP ${res.status}.`);
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    const raw = await res.text();
    let js: { resultCode?: unknown; resultDesc?: unknown; resultData?: unknown };
    try {
      js = JSON.parse(raw);
    } catch {
      if (raw.slice(0, 500).toLowerCase().includes('<html'))
        throw new EdoError(
          'auth',
          'eDo devolvió una página de login: el token no es válido o venció.',
        );
      throw new EdoError('bad_response', 'La respuesta de eDo no es JSON válido.');
    }
    if (String(js.resultCode ?? '') !== '0') {
      const desc = String(js.resultDesc ?? '').slice(0, 200);
      if (/token|auth|login|permission|unauthor/i.test(desc))
        throw new EdoError('auth', `eDo rechazó la consulta: ${desc}`);
      throw new EdoError('bad_response', `eDo resultCode=${String(js.resultCode)}: ${desc}`);
    }
    const rd = js.resultData as { total?: unknown; list?: unknown } | null;
    if (!rd || typeof rd !== 'object' || (rd.list !== undefined && !Array.isArray(rd.list)))
      throw new EdoError('bad_response', 'Formato inesperado en resultData.');
    return { total: Number(rd.total ?? 0) || 0, list: (rd.list as Raw[] | undefined) ?? [] };
  }
  throw last!;
}

const query = (cfg: EdoClientConfig, token: string, statuses: number[], page: number) =>
  post(cfg, token, {
    projectId: cfg.projectId,
    issueType: cfg.issueType,
    pageIndex: page,
    pageSize: PAGE_SIZE,
    issueStatusList: statuses,
  });

// ---------- normalization (edo_client.py normalize_item) ----------
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?$/;
const pad = (n: number) => String(n).padStart(2, '0');

/** eDo "YYYY-MM-DD HH:MM:SS" (UTC+8 without zone) or epoch → ISO with +08:00; null if empty. */
export function parseEdoDate(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') {
    if (v <= 0) return null;
    const ms = v > 1e11 ? v : v * 1000;
    const d = new Date(ms + 8 * 3_600_000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(
      d.getUTCHours(),
    )}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}+08:00`;
  }
  const s = String(v).trim();
  if (/^\d+$/.test(s)) return parseEdoDate(Number(s));
  const m = DATE_RE.exec(s);
  if (!m) return null;
  const [, y, mo, d, hh, mi, ss] = m;
  return `${y}-${mo}-${d}T${hh ?? '00'}:${mi ?? '00'}:${ss ?? '00'}+08:00`;
}

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function stripHtml(s: unknown): string {
  if (!s) return '';
  return String(s)
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e: string) =>
      e[0] === '#'
        ? String.fromCodePoint(e[1]?.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1))
        : (ENT[e.toLowerCase()] ?? m),
    )
    .replace(/\s+/g, ' ')
    .trim();
}
const person = (v: unknown) => {
  if (!v) return '';
  const s = String(v).trim();
  const m = /^\[([^\]]*)\]/.exec(s);
  return m && m[1]!.trim() ? m[1]!.trim() : s;
};
const num = (v: unknown) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
function extFields(list: unknown) {
  const out: Record<string, unknown> = {};
  for (const f of Array.isArray(list) ? list : []) {
    if (!f || typeof f !== 'object') continue;
    const r = f as Raw;
    const code = r.fieldCode ?? r.FIELD_CODE ?? r.code;
    if (!code) continue;
    let val: unknown = null;
    for (const k of [
      'fieldDisplay',
      'fieldInstValue',
      'fieldValue',
      'FIELD_VALUE',
      'value',
      'fieldValueName',
      'valueName',
    ])
      if (r[k] !== null && r[k] !== undefined && r[k] !== '') {
        val = r[k];
        break;
      }
    out[String(code)] = val;
  }
  return out;
}

/** Raw eDo item → the normalized row of the legacy `edo_incidents.json`. */
export function normalizeEdoItem(it: Raw, baseUrl = 'https://edo.iwhalecloud.com') {
  const ext = extFields(it.extensionFieldList);
  const comment = stripHtml(it.comment);
  const statusN = Number.parseInt(String(it.issueStatus ?? ''), 10);
  const status = Number.isNaN(statusN) ? null : statusN;
  const org = String(it.orgIdName ?? '');
  const id = String(it.issueId ?? '');
  return {
    id,
    no: String(it.issueNo || id),
    title: String(it.title ?? '').trim(),
    priority: String(it.priorityValue ?? '').trim() || null,
    status,
    statusName: String(it.issueStatusValue ?? ''),
    open: status === null || !TERMINAL.has(status),
    org,
    side: org.trim().toUpperCase() === 'WOM' ? 'WOM' : 'Whale',
    assignee: person(it.assigneeName),
    creator: person(it.creatorName || it.reporterName),
    created: parseEdoDate(it.createDate),
    updated: parseEdoDate(it.updateTime),
    firstOpr: parseEdoDate(it.firstOprTime),
    comment: comment.slice(0, COMMENT_MAX),
    commentDate: /^\s*\[(\d{4}-\d{2}-\d{2})\]/.exec(comment)?.[1] ?? null,
    resolved: parseEdoDate(it.resolutionTime),
    closed: parseEdoDate(it.closedDate),
    respSlaLimit: parseEdoDate(it.responseSlaLimitTime),
    respSlaAlarm: parseEdoDate(it.responseSlaLimitAlarm),
    resSlaLimit: parseEdoDate(it.resolutionSlaLimitTime),
    resSlaAlarm: parseEdoDate(it.resolutionSlaLimitAlarm),
    dayOfOver: num(it.dayOfOver),
    coordinator: person(ext.Coordinator),
    link: `${baseUrl}?issueId=${encodeURIComponent(id)}`,
  };
}

/** Stops paging closed tickets once a page is older than the window and every ticket that was open. */
function closedStop(prevOpen: Map<string, number>, now: number) {
  const cutoff = now - QUICK_CLOSED_DAYS * 86_400_000;
  const pending = new Map(prevOpen);
  return (page: Raw[]) => {
    for (const it of page) pending.delete(String(it.issueId ?? ''));
    if (!page.length) return true;
    const created = page
      .map((it) => parseEdoDate(it.createDate))
      .filter((c): c is string => !!c)
      .map((c) => Date.parse(c));
    if (!created.length) return false;
    const oldest = Math.min(...created);
    if (oldest > cutoff) return false;
    if (pending.size && Math.min(...pending.values()) < oldest) return false;
    return true;
  };
}

export interface EdoFetchResult {
  incidents: ReturnType<typeof normalizeEdoItem>[];
  /** Totals eDo reported per group (to detect pages that moved during the download). */
  totals: Record<string, number>;
  /** True when closed tickets were cut at the 100-day window (older ones kept as they were). */
  quick: boolean;
  source: 'eDo Open API' | 'fixture';
}

/**
 * Downloads and normalizes every ticket. `prevOpen` (issueId → created ms of tickets open in the
 * CRM) enables the quick mode; pass null for a full download.
 */
export async function fetchEdoIncidents(
  cfg: EdoClientConfig,
  opts: { prevOpen: Map<string, number> | null; now: number; progress?: EdoProgress },
): Promise<EdoFetchResult> {
  if (cfg.fixture) {
    const js = JSON.parse(await readFile(cfg.fixture, 'utf8')) as unknown;
    const rd = (js as { resultData?: unknown }).resultData ?? js;
    const list = Array.isArray(rd) ? rd : ((rd as { list?: Raw[] }).list ?? []);
    opts.progress?.(1, 1, 'fixture');
    return {
      incidents: dedupe(list as Raw[]).map((r) => normalizeEdoItem(r, cfg.baseUrl)),
      totals: { fixture: list.length },
      quick: false,
      source: 'fixture',
    };
  }
  const token = cfg.token?.trim();
  if (!token) throw new EdoError('no_token', 'Falta EDO_ACCESS_TOKEN en el entorno de la API.');
  const state = { done: 0, est: STATUS_GROUPS.length };
  const items: Raw[] = [];
  const totals: Record<string, number> = {};
  for (const [label, statuses] of STATUS_GROUPS) {
    const stop = label === 'cerrados' && opts.prevOpen ? closedStop(opts.prevOpen, opts.now) : null;
    const first = await query(cfg, token, statuses, 1);
    totals[label] = first.total;
    const pages = Math.max(1, Math.ceil(first.total / PAGE_SIZE));
    state.done++;
    opts.progress?.(state.done, state.est, `${label} página 1`);
    items.push(...first.list);
    if (stop) {
      let pg = 1;
      let last = first.list;
      while (!stop(last) && pg < pages) {
        pg++;
        state.est++;
        last = (await query(cfg, token, statuses, pg)).list;
        items.push(...last);
        state.done++;
        opts.progress?.(state.done, state.est, `${label} página ${pg}`);
      }
    } else if (pages > 1) {
      state.est += pages - 1;
      const queue = Array.from({ length: pages - 1 }, (_, i) => i + 2);
      await Promise.all(
        Array.from({ length: Math.min(WORKERS, queue.length) }, async () => {
          for (let pg = queue.shift(); pg !== undefined; pg = queue.shift()) {
            items.push(...(await query(cfg, token, statuses, pg)).list);
            state.done++;
            opts.progress?.(state.done, state.est, `${label} página ${pg}`);
          }
        }),
      );
    }
  }
  return {
    incidents: dedupe(items).map((r) => normalizeEdoItem(r, cfg.baseUrl)),
    totals,
    quick: !!opts.prevOpen,
    source: 'eDo Open API',
  };
}

function dedupe(list: Raw[]) {
  const seen = new Set<string>();
  return list.filter((it) => {
    const id = it && typeof it === 'object' ? String(it.issueId ?? '') : '';
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
