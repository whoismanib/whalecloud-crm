/**
 * eDo incident KPIs, SLA, "stale" and "a quién presionar hoy" (legacy dashboard `edo_logic.js`).
 *
 * Pure port: every function takes `now` (ms epoch) and the config explicitly, so the CRM gives the
 * same numbers as the legacy "Incidentes eDo" tab. Instants are absolute (ms UTC); the display zone
 * (America/Santiago) is only used for business hours, weeks and labels.
 */

/** The normalized eDo row (`edo_client.py normalize_item`), as stored in `tickets.edo`. */
export interface EdoRecord {
  id: string;
  no: string;
  title: string;
  priority: string | null;
  /** 0 New · 1 Assigned · 2 Diagnosing · 3 In Progress · 4 Resolved · 5 Closed. */
  status: number | null;
  statusName?: string;
  open?: boolean;
  org?: string;
  side?: 'Whale' | 'WOM' | string;
  assignee?: string;
  creator?: string;
  created: string | null;
  updated?: string | null;
  firstOpr?: string | null;
  comment?: string;
  commentDate?: string | null;
  resolved?: string | null;
  closed?: string | null;
  respSlaLimit?: string | null;
  respSlaAlarm?: string | null;
  resSlaLimit?: string | null;
  resSlaAlarm?: string | null;
  dayOfOver?: number | null;
  coordinator?: string;
  link?: string;
}

/** Fields kept in `tickets.edo` (and sent by the web importer). */
export const EDO_RECORD_FIELDS = [
  'id',
  'no',
  'title',
  'priority',
  'status',
  'statusName',
  'open',
  'org',
  'side',
  'assignee',
  'creator',
  'created',
  'updated',
  'firstOpr',
  'comment',
  'commentDate',
  'resolved',
  'closed',
  'respSlaLimit',
  'respSlaAlarm',
  'resSlaLimit',
  'resSlaAlarm',
  'dayOfOver',
  'coordinator',
  'link',
] as const;

/** Comment characters kept per ticket (legacy `comment_embed_chars`). */
export const EDO_COMMENT_CHARS = 300;

export interface EdoConfig {
  displayTz: string;
  ticketUrl: string;
  businessHours: { start: number; end: number; days: number[] };
  holidays: string[];
  p1Always: boolean;
  staleHours: Record<string, { Whale: number; WOM: number }>;
  sla: {
    responseHours: Record<string, number>;
    resolutionHours: Record<string, number>;
    riskRatio: number;
  };
  /** Closed/resolved tickets shown (legacy `embed_closed_days`). */
  closedDays: number;
}

/** Defaults = legacy `edo_config.json`. */
export const EDO_DEFAULT_CONFIG: EdoConfig = {
  displayTz: 'America/Santiago',
  ticketUrl: 'https://edo.iwhalecloud.com?issueId={issueId}',
  businessHours: { start: 9, end: 18, days: [1, 2, 3, 4, 5] },
  holidays: [],
  p1Always: true,
  staleHours: {
    P1: { Whale: 4, WOM: 8 },
    P2: { Whale: 8, WOM: 16 },
    P3: { Whale: 24, WOM: 40 },
    P4: { Whale: 40, WOM: 80 },
  },
  sla: {
    responseHours: { P1: 1, P2: 4, P3: 8, P4: 24 },
    resolutionHours: { P1: 24, P2: 27, P3: 90, P4: 180 },
    riskRatio: 0.8,
  },
  closedDays: 100,
};

const H = 3_600_000;
const D = 86_400_000;
export const EDO_PRIO_RANK: Record<string, number> = { P1: 1, P2: 2, P3: 3, P4: 4 };

const toMs = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

const fmtCache = new Map<string, Intl.DateTimeFormat>();
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
function tzParts(ms: number, tz: string) {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    fmtCache.set(tz, f);
  }
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
  return {
    y: +o.year!,
    m: +o.month!,
    d: +o.day!,
    h: +o.hour! % 24,
    mi: +o.minute!,
    s: +o.second!,
    wd: WD[o.weekday!]!,
  };
}
function tzOffset(ms: number, tz: string) {
  const p = tzParts(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}
/** Local time in `tz` → ms UTC (tolerates out-of-range days via Date.UTC). */
export function zonedToUtc(y: number, m: number, d: number, h: number, mi: number, tz: string) {
  const guess = Date.UTC(y, m - 1, d, h || 0, mi || 0);
  const off = tzOffset(guess, tz);
  let t = guess - off;
  const off2 = tzOffset(t, tz);
  if (off2 !== off) t = guess - off2;
  return t;
}
const pad = (n: number) => (n < 10 ? '0' : '') + n;

/** dd-mm-yyyy in the display zone. */
export function edoFmtDate(ms: number | null, tz: string) {
  if (ms == null) return '';
  const p = tzParts(ms, tz);
  return `${pad(p.d)}-${pad(p.m)}-${p.y}`;
}

/** Business hours between a and b (Mon–Fri, start–end, display zone, minus holidays). */
export function businessHours(a: number | null, b: number | null, cfg: EdoConfig) {
  if (a == null || b == null || b <= a) return 0;
  const tz = cfg.displayTz;
  const bh = cfg.businessHours;
  const hol = new Set(cfg.holidays);
  const p = tzParts(a, tz);
  let y = p.y;
  let m = p.m;
  let d = p.d;
  let total = 0;
  for (let i = 0; i < 5000; i++) {
    const day = new Date(Date.UTC(y, m - 1, d));
    const Y = day.getUTCFullYear();
    const M = day.getUTCMonth() + 1;
    const Dd = day.getUTCDate();
    const dayStart = zonedToUtc(Y, M, Dd, 0, 0, tz);
    if (dayStart > b) break;
    const key = `${Y}-${pad(M)}-${pad(Dd)}`;
    if (bh.days.includes(day.getUTCDay()) && !hol.has(key)) {
      const ws = zonedToUtc(Y, M, Dd, bh.start, 0, tz);
      const we = zonedToUtc(Y, M, Dd, bh.end, 0, tz);
      const ov = Math.min(we, b) - Math.max(ws, a);
      if (ov > 0) total += ov;
    }
    y = Y;
    m = M;
    d = Dd + 1;
  }
  return total / H;
}

/** P1 counts wall-clock hours (24x7); the rest business hours. */
export function prioHours(
  a: number | null,
  b: number | null,
  prio: string | null | undefined,
  cfg: EdoConfig,
) {
  if (a == null || b == null || b <= a) return 0;
  if (prio === 'P1' && cfg.p1Always) return (b - a) / H;
  return businessHours(a, b, cfg);
}

/** "[YYYY-MM-DD]" comment date (eDo China date, no time) → 00:00 of that day in China. */
function commentMs(t: EdoRecord) {
  if (!t.commentDate) return null;
  const x = t.commentDate.split('-');
  return zonedToUtc(+x[0]!, +x[1]!, +x[2]!, 0, 0, 'Asia/Shanghai');
}

export function edoLastActivity(t: EdoRecord, now: number) {
  let c = commentMs(t);
  if (c != null && c > now) c = now;
  let best: number | null = null;
  for (const v of [c, toMs(t.updated), toMs(t.firstOpr), toMs(t.created)])
    if (v != null && (best == null || v > best)) best = v;
  return best;
}

export const edoIsOpen = (t: EdoRecord) => t.status !== 4 && t.status !== 5 && t.open !== false;

export type EdoBallWho = 'Whale' | 'WOM' | null;
export type EdoBallLabel =
  | 'CLOSED'
  | 'WOM_VALIDATE'
  | 'NO_FIRST_RESPONSE'
  | 'WHALE_WORKING'
  | 'WAITING_WOM';

/** Who has the ball. */
export function edoBall(t: EdoRecord): { who: EdoBallWho; label: EdoBallLabel } {
  if (t.status === 5) return { who: null, label: 'CLOSED' };
  if (t.status === 4) return { who: 'WOM', label: 'WOM_VALIDATE' };
  if (t.open === false) return { who: null, label: 'CLOSED' };
  const whale =
    (t.side ||
      (String(t.org ?? '')
        .trim()
        .toUpperCase() === 'WOM'
        ? 'WOM'
        : 'Whale')) === 'Whale';
  if (whale && !t.firstOpr) return { who: 'Whale', label: 'NO_FIRST_RESPONSE' };
  if (whale) return { who: 'Whale', label: 'WHALE_WORKING' };
  return { who: 'WOM', label: 'WAITING_WOM' };
}

export interface EdoStale {
  lastAct: number | null;
  hours: number;
  threshold: number | null;
  stale: boolean;
  days: number | null;
}

export function edoStaleInfo(t: EdoRecord, now: number, cfg: EdoConfig): EdoStale {
  const b = edoBall(t);
  const la = edoLastActivity(t, now);
  const hrs = prioHours(la, now, t.priority, cfg);
  let th: number | null = null;
  if (b.who) {
    const row = cfg.staleHours[t.priority ?? ''] ?? cfg.staleHours.P4;
    th = row?.[b.who] ?? null;
  }
  return {
    lastAct: la,
    hours: hrs,
    threshold: th,
    stale: th != null && hrs > th,
    days: la == null ? null : (now - la) / D,
  };
}

export type EdoSlaState = 'BREACHED' | 'AT_RISK' | 'OK';
export interface EdoSla {
  state: EdoSlaState;
  /** 'eDo' = eDo's own SLA limits; 'est' = estimated from the config targets. */
  src: 'eDo' | 'est';
  detail: '' | 'response' | 'resolution' | 'dayOfOver';
}

/** SLA state of open tickets (null when not open). */
export function edoSlaState(t: EdoRecord, now: number, cfg: EdoConfig): EdoSla | null {
  if (!edoIsOpen(t)) return null;
  const rL = toMs(t.respSlaLimit);
  const sL = toMs(t.resSlaLimit);
  if (rL != null || sL != null) {
    const rA = toMs(t.respSlaAlarm);
    const sA = toMs(t.resSlaAlarm);
    const noFirst = !t.firstOpr;
    if ((noFirst && rL != null && now > rL) || (sL != null && now > sL) || (t.dayOfOver ?? 0) > 0)
      return {
        state: 'BREACHED',
        src: 'eDo',
        detail: noFirst && rL != null && now > rL ? 'response' : 'resolution',
      };
    if ((noFirst && rA != null && now > rA) || (sA != null && now > sA))
      return {
        state: 'AT_RISK',
        src: 'eDo',
        detail: noFirst && rA != null && now > rA ? 'response' : 'resolution',
      };
    return { state: 'OK', src: 'eDo', detail: '' };
  }
  if ((t.dayOfOver ?? 0) > 0) return { state: 'BREACHED', src: 'eDo', detail: 'dayOfOver' };
  const p = t.priority || 'P4';
  const created = toMs(t.created);
  let worst: EdoSlaState = 'OK';
  let detail: EdoSla['detail'] = '';
  const check = (used: number | null, target: number | undefined, what: EdoSla['detail']) => {
    if (target == null || used == null) return;
    if (used > target) {
      worst = 'BREACHED';
      detail = what;
    } else if (used >= cfg.sla.riskRatio * target && worst !== 'BREACHED') {
      worst = 'AT_RISK';
      detail = what;
    }
  };
  if (!t.firstOpr) check(prioHours(created, now, p, cfg), cfg.sla.responseHours[p], 'response');
  // Estimated resolution clock pauses while the ball is with WOM (until the last activity).
  const b = edoBall(t);
  let end = now;
  if (b.who === 'WOM') {
    const la = edoLastActivity(t, now);
    if (la != null && la < now) end = la;
  }
  check(prioHours(created, end, p, cfg), cfg.sla.resolutionHours[p], 'resolution');
  return { state: worst, src: 'est', detail };
}

const closeMs = (t: EdoRecord) => {
  let c = toMs(t.closed);
  if (c == null && t.status === 5) c = toMs(t.resolved);
  return c;
};
const endMs = (t: EdoRecord) => {
  let c = closeMs(t);
  if (c == null && t.status === 4) c = toMs(t.resolved);
  return c;
};

export interface EdoEnriched extends EdoRecord {
  _open: boolean;
  _ball: { who: EdoBallWho; label: EdoBallLabel };
  _createdMs: number | null;
  _ageDays: number | null;
  _closeMs: number | null;
  _respH: number | null;
  _stale: EdoStale;
  _sla: EdoSla | null;
  _prioRank: number;
}

export function edoEnrich(list: readonly EdoRecord[], now: number, cfg: EdoConfig): EdoEnriched[] {
  return list.map((t) => {
    const open = edoIsOpen(t);
    const created = toMs(t.created);
    const closed = closeMs(t);
    const fo = toMs(t.firstOpr);
    return {
      ...t,
      _open: open,
      _ball: edoBall(t),
      _createdMs: created,
      _ageDays: created == null ? null : ((closed && !open ? closed : now) - created) / D,
      _closeMs: closed,
      _respH: fo != null && created != null ? (fo - created) / H : null,
      _stale:
        open || t.status === 4
          ? edoStaleInfo(t, now, cfg)
          : {
              lastAct: edoLastActivity(t, now),
              hours: 0,
              threshold: null,
              stale: false,
              days: null,
            },
      _sla: edoSlaState(t, now, cfg),
      _prioRank: EDO_PRIO_RANK[t.priority ?? ''] ?? 9,
    };
  });
}

function median(a: number[]): number | null {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}
function pct(a: number[], p: number): number | null {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]!;
}

export type EdoKpiKey =
  | 'open'
  | 'whale'
  | 'wom'
  | 'p12'
  | 'breached'
  | 'risk'
  | 'nofirst'
  | 'resp30'
  | 'closed7'
  | 'closed30';

/** KPI predicates; the incidents table uses them as filters. */
export function edoKpiFilter(key: EdoKpiKey, now: number): (e: EdoEnriched) => boolean {
  switch (key) {
    case 'open':
      return (e) => e._open;
    case 'whale':
      return (e) => e._open && e.side === 'Whale';
    case 'wom':
      return (e) => e._open && e.side === 'WOM';
    case 'p12':
      return (e) => e._open && (e.priority === 'P1' || e.priority === 'P2');
    case 'breached':
      return (e) => e._open && e._sla?.state === 'BREACHED';
    case 'risk':
      return (e) => e._open && e._sla?.state === 'AT_RISK';
    case 'nofirst':
      return (e) => e._open && e.side === 'Whale' && !e.firstOpr;
    case 'resp30':
      return (e) =>
        e._createdMs != null &&
        e._createdMs >= now - 30 * D &&
        e._createdMs <= now &&
        e._respH != null;
    case 'closed7':
    case 'closed30': {
      const days = key === 'closed7' ? 7 : 30;
      return (e) => e._closeMs != null && e._closeMs >= now - days * D && e._closeMs <= now;
    }
  }
}

export interface EdoKpis {
  open: number;
  whale: number;
  wom: number;
  byOrg: Record<string, number>;
  p12: number;
  p1WhaleOpen: number;
  breached: number;
  risk: number;
  nofirst: number;
  resp30: { v: number | null; n: number };
  resp30P1: { v: number | null; n: number };
  resp30P2: { v: number | null; n: number };
  closed7: number;
  closed30: number;
  oldest: { no: string; id: string; days: number; org: string; ball: EdoBallLabel } | null;
}

export function edoKpis(en: readonly EdoEnriched[], now: number): EdoKpis {
  const open = en.filter((e) => e._open);
  const byOrg: Record<string, number> = {};
  for (const e of open) {
    const k = e.org || '(sin org)';
    byOrg[k] = (byOrg[k] ?? 0) + 1;
  }
  const cnt = (k: EdoKpiKey) => en.filter(edoKpiFilter(k, now)).length;
  const r30 = en.filter(edoKpiFilter('resp30', now));
  const med = (p?: string) => {
    const a = r30.filter((e) => !p || e.priority === p).map((e) => e._respH!);
    return { v: median(a), n: a.length };
  };
  let oldest: EdoEnriched | null = null;
  for (const e of open)
    if (e._createdMs != null && (!oldest || e._createdMs < oldest._createdMs!)) oldest = e;
  return {
    open: open.length,
    whale: cnt('whale'),
    wom: cnt('wom'),
    byOrg,
    p12: cnt('p12'),
    p1WhaleOpen: open.filter((e) => e.priority === 'P1' && e.side === 'Whale').length,
    breached: cnt('breached'),
    risk: cnt('risk'),
    nofirst: cnt('nofirst'),
    resp30: med(),
    resp30P1: med('P1'),
    resp30P2: med('P2'),
    closed7: cnt('closed7'),
    closed30: cnt('closed30'),
    oldest: oldest
      ? {
          no: oldest.no,
          id: oldest.id,
          days: (now - oldest._createdMs!) / D,
          org: oldest.org ?? '',
          ball: oldest._ball.label,
        }
      : null,
  };
}

const SLA_RANK: Record<EdoSlaState, number> = { BREACHED: 0, AT_RISK: 1, OK: 2 };
const pushRank = (e: EdoEnriched) =>
  e._sla && e._sla.state !== 'OK' ? SLA_RANK[e._sla.state] : e._stale.stale ? 2 : 3;

/** Open, ball with Whale, and SLA breached/at risk, stale or without a first response. */
export const edoNeedsPush = (e: EdoEnriched) =>
  e._open &&
  e._ball.who === 'Whale' &&
  (e._sla?.state === 'BREACHED' || e._sla?.state === 'AT_RISK' || e._stale.stale || !e.firstOpr);

export interface EdoPushGroup {
  name: string;
  team: string;
  person: boolean;
  items: EdoEnriched[];
  breached: number;
  worstPrio: number;
}

/** "A quién presionar hoy": tickets that need a push, grouped by assignee (or team). */
export function edoPushGroups(en: readonly EdoEnriched[]): EdoPushGroup[] {
  const groups = new Map<string, EdoPushGroup>();
  for (const e of en.filter(edoNeedsPush)) {
    const key = e.assignee ? `a:${e.assignee}` : `o:${e.org ?? ''}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        name: e.assignee || `Equipo ${e.org || '?'}`,
        team: e.org ?? '',
        person: !!e.assignee,
        items: [],
        breached: 0,
        worstPrio: 9,
      };
      groups.set(key, g);
    }
    g.items.push(e);
  }
  const arr = [...groups.values()].map((g) => {
    g.items.sort(
      (a, b) =>
        pushRank(a) - pushRank(b) || a._prioRank - b._prioRank || b._stale.hours - a._stale.hours,
    );
    g.breached = g.items.filter((e) => e._sla?.state === 'BREACHED').length;
    g.worstPrio = Math.min(...g.items.map((e) => e._prioRank));
    g.team = [...new Set(g.items.map((e) => e.org ?? ''))].join(', ');
    return g;
  });
  arr.sort(
    (a, b) =>
      b.breached - a.breached ||
      a.worstPrio - b.worstPrio ||
      b.items.length - a.items.length ||
      (a.name < b.name ? -1 : 1),
  );
  return arr;
}

/** Stale tickets waiting on WOM (to remind the customer). */
export function edoWomPending(en: readonly EdoEnriched[]): EdoEnriched[] {
  return en
    .filter((e) => (e._open || e.status === 4) && e._ball.who === 'WOM' && e._stale.stale)
    .sort((a, b) => a._prioRank - b._prioRank || b._stale.hours - a._stale.hours);
}

export const edoTicketLink = (e: EdoRecord, cfg: EdoConfig) =>
  cfg.ticketUrl.replace('{issueId}', encodeURIComponent(e.id || ''));

const SLA_ES: Record<EdoSlaState, string> = {
  BREACHED: 'Vencido',
  AT_RISK: 'En riesgo',
  OK: 'OK',
};
const slaText = (e: EdoEnriched) =>
  e._sla ? SLA_ES[e._sla.state] + (e._sla.src === 'est' ? ' (estimado)' : '') : '-';
const fill = (tpl: string, vars: Record<string, string | number | null | undefined>) =>
  tpl.replace(/\{(\w+)\}/g, (_m, k: string) =>
    vars[k] != null && vars[k] !== '' ? String(vars[k]) : '-',
  );

/** Reminder for the Whale assignee (legacy TPL_WHALE, Spanish as in the legacy tab). */
export function edoReminderWhale(e: EdoEnriched, cfg: EdoConfig) {
  return fill(
    'Hola {nombre}, ¿me ayudas con el {issueNo} ({prioridad}) de WOM: "{titulo}"? Lleva {edad} días abierto y {diasSinAct} días sin actualización; SLA: {estadoSLA}. WOM espera respuesta. ¿Me compartes estado y ETA hoy? Gracias. {link}',
    {
      nombre: e.assignee || `equipo ${e.org || 'Whale'}`,
      issueNo: e.no,
      prioridad: e.priority || 's/p',
      titulo: e.title,
      edad: Math.floor(e._ageDays ?? 0),
      diasSinAct: Math.floor(e._stale.days ?? 0),
      estadoSLA: slaText(e),
      link: edoTicketLink(e, cfg),
    },
  );
}

/** Reminder for the WOM creator (legacy TPL_WOM). */
export function edoReminderWom(e: EdoEnriched, cfg: EdoConfig) {
  return fill(
    'Hola {creador}, sobre el {issueNo} "{titulo}": quedamos atentos a su confirmación/información desde el {fechaUltimaAct}. ¿Nos pueden ayudar a avanzar o confirmar el cierre? Gracias.',
    {
      creador: e.creator || 'equipo WOM',
      issueNo: e.no,
      titulo: e.title,
      fechaUltimaAct: edoFmtDate(e._stale.lastAct, cfg.displayTz),
    },
  );
}

/** One message with every ticket of a push group. */
export function edoGroupSummary(g: EdoPushGroup, cfg: EdoConfig) {
  const lines = [`Hola ${g.name}, te comparto los tickets de WOM que necesitan tu ayuda hoy:`];
  for (const e of g.items)
    lines.push(
      `- ${e.no} (${e.priority || 's/p'}) "${e.title}": ${Math.floor(e._ageDays ?? 0)} d abierto, ${Math.floor(
        e._stale.days ?? 0,
      )} d sin actualización, SLA ${slaText(e)}. ${edoTicketLink(e, cfg)}`,
    );
  lines.push('¿Me compartes estado y ETA de cada uno hoy? Gracias.');
  return lines.join('\n');
}

export interface EdoWeek {
  label: string;
  start: number;
  end: number;
  created: number;
  closed: number;
  backlog: number;
  respMedian: number | null;
  respP90: number | null;
  respN: number;
}

/** Last 12 ISO weeks (Mon–Sun, display zone): created, closed, backlog and first response. */
export function edoTrends(en: readonly EdoEnriched[], now: number, cfg: EdoConfig, n = 12) {
  const tz = cfg.displayTz;
  const p = tzParts(now, tz);
  const back = (p.wd + 6) % 7;
  const out: EdoWeek[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const sd = new Date(Date.UTC(p.y, p.m - 1, p.d - back - 7 * i));
    const ed = new Date(Date.UTC(p.y, p.m - 1, p.d - back - 7 * i + 7));
    const w = {
      start: zonedToUtc(sd.getUTCFullYear(), sd.getUTCMonth() + 1, sd.getUTCDate(), 0, 0, tz),
      end: zonedToUtc(ed.getUTCFullYear(), ed.getUTCMonth() + 1, ed.getUTCDate(), 0, 0, tz),
      label: `${pad(sd.getUTCDate())}-${pad(sd.getUTCMonth() + 1)}`,
    };
    let created = 0;
    let closed = 0;
    let backlog = 0;
    const resp: number[] = [];
    for (const e of en) {
      const c = e._createdMs;
      const x = e._closeMs;
      const end = endMs(e);
      if (c != null && c >= w.start && c < w.end) {
        created++;
        if (e._respH != null) resp.push(e._respH);
      }
      if (x != null && x >= w.start && x < w.end) closed++;
      const cut = Math.min(w.end, now);
      if (c != null && c < cut && (end == null || end >= cut)) backlog++;
    }
    out.push({
      ...w,
      created,
      closed,
      backlog,
      respMedian: median(resp),
      respP90: pct(resp, 0.9),
      respN: resp.length,
    });
  }
  return out;
}

const BUCKETS = [
  { k: '0-2 d', max: 3 },
  { k: '3-7 d', max: 8 },
  { k: '8-30 d', max: 31 },
  { k: '31-90 d', max: 91 },
  { k: '>90 d', max: Infinity },
];
/** Open tickets by age, split by who has the ball. */
export function edoAgingBuckets(en: readonly EdoEnriched[], now: number) {
  const out = BUCKETS.map((b) => ({ k: b.k, Whale: 0, WOM: 0 }));
  for (const e of en) {
    if (!e._open || e._createdMs == null) continue;
    const d = Math.floor((now - e._createdMs) / D);
    const i = BUCKETS.findIndex((b) => d < b.max);
    out[i]![e._ball.who === 'WOM' ? 'WOM' : 'Whale']++;
  }
  return out;
}

/** Keeps the fields stored in `tickets.edo`; trims the comment. */
export function edoRecordOf(r: Record<string, unknown>): EdoRecord {
  const o: Record<string, unknown> = {};
  for (const k of EDO_RECORD_FIELDS) if (r[k] !== undefined) o[k] = r[k];
  if (typeof o.comment === 'string') o.comment = o.comment.slice(0, EDO_COMMENT_CHARS);
  return o as unknown as EdoRecord;
}
