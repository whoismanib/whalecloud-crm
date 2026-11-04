import type { ActivityDirection, TopicState } from '../enums';

/**
 * Maps the legacy `crm_cache.json` (per-project 30-day mail/calendar aggregates of one mailbox,
 * ADR 0008 phase 0) to engagement topics, digest activities and a mailbox snapshot. Pure: account
 * and opportunity candidates come in as arguments; nothing is created from mail metadata.
 */

export interface LegacyMailProject {
  client: string;
  section: string;
  project: string;
  inbox: number;
  sent: number;
  meetings: number;
  upcoming: number;
  last_date: string | null;
  next_meeting: string | null;
  recent_subjects: string[];
  hold: string;
  closed: string;
  edo: string[];
  status: string;
  seen_date: string | null;
  /** Days since the last movement; for topics without mail it is the age of the eDo ticket. */
  last_days: number;
}

export interface LegacyMailCache {
  generated_at: string;
  window_days: number;
  inbox_count: number;
  sent_count: number;
  calendar_count: number;
  matched: number;
  meetings_matched: number;
  upcoming_matched: number;
  unmatched_count: number;
  unmatched_events: number;
  clients: Record<string, { sections: Record<string, { projects: LegacyMailProject[] }> }>;
}

export interface NamedRef {
  id: string;
  name: string;
}
export interface OpportunityRef extends NamedRef {
  accountId: string;
}

export interface MappedTopic {
  externalKey: string;
  clientLabel: string;
  section: string;
  name: string;
  accountId: string;
  opportunityId: string | null;
  state: TopicState;
  stateReason: string | null;
  edoRefs: string[];
  lastSeenAt: string | null;
  /**
   * Last eDo update as seen by the legacy dashboard, for topics whose only movement is a ticket.
   * Used when those tickets are not in the CRM yet (P10).
   */
  edoLastUpdateAt: string | null;
}

export type DigestKind = 'EMAIL_IN' | 'EMAIL_OUT' | 'MEETING' | 'MEETING_UPCOMING';

export interface MappedActivity {
  topicKey: string;
  externalKey: string;
  accountId: string;
  opportunityId: string | null;
  type: 'EMAIL' | 'MEETING';
  direction: ActivityDirection | null;
  itemCount: number;
  occurredAt: string;
  subject: string;
  notes: string | null;
}

export interface MailSnapshotCounts {
  windowDays: number;
  inboxCount: number;
  sentCount: number;
  calendarCount: number;
  matchedCount: number;
  meetingsMatched: number;
  upcomingMatched: number;
  unmatchedCount: number;
  unmatchedEvents: number;
}

export interface MailCacheFailure {
  row: number;
  source: string;
  code: 'CLIENT_NOT_MAPPED' | 'CLIENT_AMBIGUOUS';
  params: Record<string, string | number>;
}

export interface MappedMailCache {
  snapshot: MailSnapshotCounts;
  topics: MappedTopic[];
  activities: MappedActivity[];
  failures: MailCacheFailure[];
  /** Topics whose client could not be mapped to an account (not imported). */
  skippedTopics: number;
}

const STOP = new Set(['y', 'and', 'de', 'del', 'la', 'el', 'the', 'grupo', 'group', 'sa', 'spa']);
const PLACES = new Set(['chile', 'peru', 'mexico', 'colombia', 'bolivia', 'china', 'latam']);

/** Lowercase, no accents, no "(…)", punctuation as spaces. */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const tokens = (s: string) =>
  normalizeName(s)
    .split(' ')
    .filter((t) => t && !STOP.has(t));

/** Score of a client label against an account name: 0 = no match. */
function nameScore(label: string, account: string): number {
  if (normalizeName(label) === normalizeName(account)) return 1000;
  const a = tokens(account);
  const c = tokens(label);
  if (!a.length || !c.length) return 0;
  const inter = a.filter((t) => c.includes(t));
  if (!inter.some((t) => !PLACES.has(t))) return 0;
  const subset = inter.length === a.length || inter.length === c.length;
  return subset ? inter.length : 0;
}

/**
 * Account for a legacy client label ("WOM Chile" → "WOM", "BancoEstado / Rutpay" → "BancoEstado").
 * Every "/" part is tried; the best unique score wins. `aliases` (label → account name) overrides.
 */
export function matchAccountByName<T extends NamedRef>(
  label: string,
  accounts: readonly T[],
  aliases: Record<string, string> = {},
): { account: T | null; ambiguous: boolean } {
  const alias = aliases[label];
  if (alias) {
    const hit = accounts.find((a) => normalizeName(a.name) === normalizeName(alias)) ?? null;
    return { account: hit, ambiguous: false };
  }
  const parts = [label, ...label.split('/')].map((p) => p.trim()).filter(Boolean);
  let best: T[] = [];
  let bestScore = 0;
  for (const acc of accounts) {
    const s = Math.max(...parts.map((p) => nameScore(p, acc.name)));
    if (s === 0 || s < bestScore) continue;
    if (s > bestScore) best = [];
    bestScore = s;
    best.push(acc);
  }
  if (best.length === 1) return { account: best[0]!, ambiguous: false };
  return { account: null, ambiguous: best.length > 1 };
}

/**
 * Conservative opportunity link for a topic: same normalized name, or one name contains the other
 * as whole words with at least two tokens; only when exactly one candidate qualifies.
 */
export function matchTopicOpportunity<T extends NamedRef>(
  topic: string,
  candidates: readonly T[],
): T | null {
  const t = ` ${normalizeName(topic)} `;
  const hits = candidates.filter((c) => {
    const n = normalizeName(c.name);
    if (!n) return false;
    if (` ${n} ` === t) return true;
    const shorter = n.length < t.trim().length ? n : t.trim();
    const longer = ` ${n.length < t.trim().length ? t.trim() : n} `;
    return shorter.split(' ').length >= 2 && longer.includes(` ${shorter} `);
  });
  return hits.length === 1 ? hits[0]! : null;
}

const MEETING_PREFIX = /^\[reuni[oó]n\]\s*/i;
const n0 = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
const cut = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Topic state from the legacy labels: Closed/Resolved or `closed` text → CLOSED; `hold` → ON_HOLD. */
export function legacyTopicState(p: Pick<LegacyMailProject, 'hold' | 'closed' | 'status'>): {
  state: TopicState;
  reason: string | null;
} {
  if (p.closed) return { state: 'CLOSED', reason: p.closed };
  if (p.status === 'Closed' || p.status === 'Resolved')
    return { state: 'CLOSED', reason: `Legacy: ${p.status}` };
  if (p.hold) return { state: 'ON_HOLD', reason: p.hold };
  return { state: 'ACTIVE', reason: null };
}

const DAY_MS = 86_400_000;
function edoOnlyUpdate(p: LegacyMailProject, generatedAt: string): string | null {
  const past = n0(p.inbox) + n0(p.sent) + n0(p.meetings);
  const ticketDriven = p.status === 'Stale' || p.status === 'In Progress';
  if (past > 0 || !p.edo?.length || !ticketDriven || !(p.last_days < 999)) return null;
  return new Date(Date.parse(generatedAt) - p.last_days * DAY_MS).toISOString();
}

export function mapLegacyMailCache(
  cache: LegacyMailCache,
  opts: {
    ownerKey: string;
    generatedAt: string;
    accounts: readonly NamedRef[];
    opportunities: readonly OpportunityRef[];
    aliases?: Record<string, string>;
  },
): MappedMailCache {
  const out: MappedMailCache = {
    snapshot: {
      windowDays: n0(cache.window_days) || 30,
      inboxCount: n0(cache.inbox_count),
      sentCount: n0(cache.sent_count),
      calendarCount: n0(cache.calendar_count),
      matchedCount: n0(cache.matched),
      meetingsMatched: n0(cache.meetings_matched),
      upcomingMatched: n0(cache.upcoming_matched),
      unmatchedCount: n0(cache.unmatched_count),
      unmatchedEvents: n0(cache.unmatched_events),
    },
    topics: [],
    activities: [],
    failures: [],
    skippedTopics: 0,
  };
  let row = 0;
  for (const [client, c] of Object.entries(cache.clients ?? {})) {
    row++;
    const projects = Object.values(c.sections ?? {}).flatMap((s) => s.projects ?? []);
    const { account, ambiguous } = matchAccountByName(client, opts.accounts, opts.aliases);
    if (!account) {
      out.failures.push({
        row,
        source: 'clients',
        code: ambiguous ? 'CLIENT_AMBIGUOUS' : 'CLIENT_NOT_MAPPED',
        params: {
          ref: client,
          projects: projects.length,
          emails: projects.reduce((a, p) => a + n0(p.inbox) + n0(p.sent), 0),
          meetings: projects.reduce((a, p) => a + n0(p.meetings), 0),
        },
      });
      out.skippedTopics += projects.length;
      continue;
    }
    const opps = opts.opportunities.filter((o) => o.accountId === account.id);
    for (const p of projects) {
      const key = `${client}|${p.section}|${p.project}`;
      const opp = matchTopicOpportunity(p.project, opps);
      const st = legacyTopicState(p);
      out.topics.push({
        externalKey: key,
        clientLabel: client,
        section: p.section,
        name: p.project,
        accountId: account.id,
        opportunityId: opp?.id ?? null,
        state: st.state,
        stateReason: st.reason ? cut(st.reason, 500) : null,
        edoRefs: (p.edo ?? []).map(String),
        lastSeenAt: p.seen_date ?? null,
        edoLastUpdateAt: edoOnlyUpdate(p, opts.generatedAt),
      });
      const subjects = (p.recent_subjects ?? []).map((s) => s.trim()).filter(Boolean);
      const mailSubject = subjects.find((s) => !MEETING_PREFIX.test(s));
      const meetingSubject = subjects
        .find((s) => MEETING_PREFIX.test(s))
        ?.replace(MEETING_PREFIX, '');
      const notes = subjects.length ? cut(subjects.join('\n'), 4000) : null;
      const last = p.last_date ?? opts.generatedAt;
      const push = (
        kind: DigestKind,
        count: number,
        occurredAt: string | null,
        subject: string | undefined,
      ) => {
        if (count <= 0 || !occurredAt) return;
        out.activities.push({
          topicKey: key,
          externalKey: `${opts.ownerKey}:${key}:${kind}`,
          accountId: account.id,
          opportunityId: opp?.id ?? null,
          type: kind.startsWith('EMAIL') ? 'EMAIL' : 'MEETING',
          direction: kind === 'EMAIL_IN' ? 'IN' : kind === 'EMAIL_OUT' ? 'OUT' : null,
          itemCount: count,
          occurredAt,
          subject: cut(subject || p.project, 300),
          notes: kind === 'MEETING_UPCOMING' ? null : notes,
        });
      };
      push('EMAIL_IN', n0(p.inbox), last, mailSubject);
      push('EMAIL_OUT', n0(p.sent), last, mailSubject);
      push('MEETING', n0(p.meetings), last, meetingSubject);
      push('MEETING_UPCOMING', n0(p.upcoming), p.next_meeting, p.project);
    }
  }
  return out;
}
