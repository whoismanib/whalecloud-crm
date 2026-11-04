import {
  accountEngagement,
  engagementScore,
  engagementSummary,
  mapLegacyMailCache,
  type EngagementTicket,
  type LegacyMailCache,
  type MappedMailCache,
} from '@wcrm/shared';
import { and, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import type { Actor } from '../../audit/record';
import type { DbOrTx } from '../../db/client';
import {
  accounts,
  activities,
  engagementTopics,
  mailSnapshots,
  opportunities,
  tickets,
  users,
} from '../../db/schema/index';
import { conflict } from '../../lib/errors';
import { dateInTz } from '../../lib/dates';
import type { ImportReport } from '../imports/service';

/** ADR 0008: mail-derived rows are always tagged with their source; phase 0 = legacy cache. */
const SOURCE = 'LEGACY_MAIL_CACHE' as const;
export const ENGAGEMENT_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

/** Offset (ms) of `timeZone` at instant `utcMs`, e.g. -3 h for America/Santiago in summer. */
function tzOffsetMs(utcMs: number, timeZone: string): number {
  const name =
    new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(new Date(utcMs))
      .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3] ?? 0)) * 60_000;
}

/**
 * `crm_cache.json` stamps `generated_at` in the Mac's local time without offset
 * ("2026-11-02 15:46:54"); ISO strings with an offset are taken as is.
 */
export function localToUtc(value: string, timeZone: string): Date {
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(value)) return new Date(value);
  const [d, t = '00:00:00'] = value.trim().split(/[ T]/);
  const [y, mo, da] = d!.split('-').map(Number);
  const [h, mi, s = 0] = t.split(':').map(Number);
  const guess = Date.UTC(y!, mo! - 1, da!, h!, mi!, s);
  let utc = guess - tzOffsetMs(guess, timeZone);
  utc = guess - tzOffsetMs(utc, timeZone);
  return new Date(utc);
}

export interface MailImportReport extends ImportReport {
  generatedAt: string;
  replacedActivities: number;
  linkedOpportunities: number;
}

/**
 * Imports one mailbox's legacy `crm_cache.json` (phase 0). Idempotent: every run replaces the
 * previous digests of that owner (a cache is a rolling 30-day window, so adding would double
 * count), so the same file twice gives the same rows; an older cache than the last one is refused.
 */
export async function importLegacyMailCache(
  db: DbOrTx,
  actor: Actor,
  ownerUserId: string,
  cache: LegacyMailCache,
  opts: { timeZone: string; aliases?: Record<string, string> },
): Promise<MailImportReport> {
  const generatedAt = localToUtc(cache.generated_at, opts.timeZone);
  const projects = Object.values(cache.clients).flatMap((c) =>
    Object.values(c.sections).flatMap((s) => s.projects),
  );
  const report: MailImportReport = {
    rowsTotal: projects.length,
    rowsOk: 0,
    created: {},
    skipped: 0,
    errors: [],
    generatedAt: generatedAt.toISOString(),
    replacedActivities: 0,
    linkedOpportunities: 0,
  };
  const [latest] = await db
    .select({ generatedAt: mailSnapshots.generatedAt })
    .from(mailSnapshots)
    .where(and(eq(mailSnapshots.userId, ownerUserId), eq(mailSnapshots.source, SOURCE)))
    .orderBy(desc(mailSnapshots.generatedAt))
    .limit(1);
  // Same cache again re-applies (same end state, picks up new accounts/aliases); older is refused.
  if (latest && latest.generatedAt > generatedAt) {
    throw conflict('MAIL_CACHE_OLDER', [
      {
        code: 'MAIL_CACHE_OLDER',
        params: { latest: latest.generatedAt.toISOString(), received: generatedAt.toISOString() },
      },
    ]);
  }

  const accs = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(isNull(accounts.archivedAt));
  const opps = await db
    .select({ id: opportunities.id, name: opportunities.name, accountId: opportunities.accountId })
    .from(opportunities)
    .where(isNull(opportunities.archivedAt));
  const mapped: MappedMailCache = mapLegacyMailCache(cache, {
    ownerKey: ownerUserId,
    generatedAt: generatedAt.toISOString(),
    accounts: accs,
    opportunities: opps,
    aliases: opts.aliases,
  });
  report.errors.push(...mapped.failures);
  report.skipped = mapped.skippedTopics;

  // Replace the previous digests of this owner.
  const removed = await db
    .delete(activities)
    .where(
      and(eq(activities.source, SOURCE), sql`${ownerUserId}::uuid = ANY(${activities.userIds})`),
    )
    .returning({ id: activities.id });
  report.replacedActivities = removed.length;

  const topicIds = new Map<string, string>();
  for (const t of mapped.topics) {
    const values = {
      ownerUserId,
      source: SOURCE,
      externalKey: t.externalKey,
      accountId: t.accountId,
      opportunityId: t.opportunityId,
      clientLabel: t.clientLabel,
      section: t.section,
      name: t.name,
      state: t.state,
      stateReason: t.stateReason,
      edoRefs: t.edoRefs,
      edoLastUpdateAt: t.edoLastUpdateAt ? new Date(t.edoLastUpdateAt) : null,
      lastSeenAt: t.lastSeenAt ? new Date(t.lastSeenAt) : null,
    };
    const [row] = await db
      .insert(engagementTopics)
      .values({ ...values, createdBy: actor.userId })
      .onConflictDoUpdate({
        target: [
          engagementTopics.ownerUserId,
          engagementTopics.source,
          engagementTopics.externalKey,
        ],
        set: {
          ...values,
          updatedAt: new Date(),
          updatedBy: actor.userId,
          rowVersion: sql`${engagementTopics.rowVersion} + 1`,
        },
      })
      .returning({ id: engagementTopics.id });
    topicIds.set(t.externalKey, row!.id);
    if (t.opportunityId) report.linkedOpportunities++;
    report.rowsOk++;
  }
  // Topics that left the taxonomy disappear with the new cache.
  const keep = [...topicIds.values()];
  await db
    .delete(engagementTopics)
    .where(
      and(
        eq(engagementTopics.ownerUserId, ownerUserId),
        eq(engagementTopics.source, SOURCE),
        keep.length ? notInArray(engagementTopics.id, keep) : sql`true`,
      ),
    );
  report.created.topics = mapped.topics.length;

  const rows = mapped.activities.map((a) => ({
    accountId: a.accountId,
    opportunityId: a.opportunityId,
    type: a.type,
    occurredAt: new Date(a.occurredAt),
    subject: a.subject,
    notes: a.notes,
    userIds: [ownerUserId],
    source: SOURCE,
    externalKey: a.externalKey,
    direction: a.direction,
    itemCount: a.itemCount,
    topicId: topicIds.get(a.topicKey) ?? null,
    createdBy: actor.userId,
  }));
  for (let i = 0; i < rows.length; i += 200) {
    await db.insert(activities).values(rows.slice(i, i + 200));
  }
  report.created.activities = rows.length;
  report.created.emails = mapped.activities
    .filter((a) => a.type === 'EMAIL')
    .reduce((s, a) => s + a.itemCount, 0);
  report.created.meetings = mapped.activities
    .filter((a) => a.type === 'MEETING' && Date.parse(a.occurredAt) <= generatedAt.getTime())
    .reduce((s, a) => s + a.itemCount, 0);

  // Same rule as POST /activities: the last past interaction moves `last_activity_at`.
  const lastByOpp = new Map<string, Date>();
  for (const a of rows) {
    if (!a.opportunityId || a.occurredAt > generatedAt) continue;
    const prev = lastByOpp.get(a.opportunityId);
    if (!prev || a.occurredAt > prev) lastByOpp.set(a.opportunityId, a.occurredAt);
  }
  for (const [id, at] of lastByOpp) {
    await db
      .update(opportunities)
      .set({
        lastActivityAt: sql`greatest(coalesce(${opportunities.lastActivityAt}, ${at}), ${at})`,
      })
      .where(eq(opportunities.id, id));
  }

  await db
    .insert(mailSnapshots)
    .values({ userId: ownerUserId, source: SOURCE, generatedAt, ...mapped.snapshot })
    .onConflictDoUpdate({
      target: [mailSnapshots.userId, mailSnapshots.source, mailSnapshots.generatedAt],
      set: { ...mapped.snapshot },
    });
  report.created.snapshots = 1;
  return report;
}

// ---------- read side: engagement per account (legacy "Salud por cliente") ----------

export interface EngagementCountsRow {
  inbox: number;
  sent: number;
  /** E-mails logged by hand (no direction): engagement, but neither inbound nor outbound. */
  other: number;
  meetings: number;
  upcoming: number;
  lastAt: Date | null;
  nextMeetingAt: Date | null;
}

/**
 * The instant used for 30-day windows: the real clock when `today` is the current local date,
 * otherwise noon UTC of `today` (tests and `x-test-today`).
 */
export function instantFor(today: string, timeZone: string): Date {
  const now = new Date();
  return dateInTz(now, timeZone) === today ? now : new Date(`${today}T12:00:00Z`);
}

/** SUM(item_count) of e-mails/meetings in the window, grouped by `key` (topic or opportunity). */
async function windowCounts(
  db: DbOrTx,
  key: typeof activities.topicId | typeof activities.opportunityId,
  ids: string[],
  now: Date,
): Promise<Map<string, EngagementCountsRow>> {
  if (!ids.length) return new Map();
  const since = new Date(now.getTime() - ENGAGEMENT_WINDOW_DAYS * DAY_MS);
  const past = sql`${activities.occurredAt} >= ${since} AND ${activities.occurredAt} <= ${now}`;
  const rows = await db
    .select({
      id: key,
      inbox: sql<number>`coalesce(sum(${activities.itemCount}) FILTER (WHERE ${activities.type} = 'EMAIL' AND ${activities.direction} = 'IN' AND ${past}), 0)::int`,
      sent: sql<number>`coalesce(sum(${activities.itemCount}) FILTER (WHERE ${activities.type} = 'EMAIL' AND ${activities.direction} = 'OUT' AND ${past}), 0)::int`,
      other: sql<number>`coalesce(sum(${activities.itemCount}) FILTER (WHERE ${activities.type} = 'EMAIL' AND ${activities.direction} IS NULL AND ${past}), 0)::int`,
      meetings: sql<number>`coalesce(sum(${activities.itemCount}) FILTER (WHERE ${activities.type} IN ('MEETING','DEMO','CALL') AND ${past}), 0)::int`,
      upcoming: sql<number>`coalesce(sum(${activities.itemCount}) FILTER (WHERE ${activities.type} = 'MEETING' AND ${activities.occurredAt} > ${now}), 0)::int`,
      lastAt: sql<Date | null>`max(${activities.occurredAt}) FILTER (WHERE ${past})`,
      nextMeetingAt: sql<Date | null>`min(${activities.occurredAt}) FILTER (WHERE ${activities.type} = 'MEETING' AND ${activities.occurredAt} > ${now})`,
    })
    .from(activities)
    .where(inArray(key, ids))
    .groupBy(key);
  return new Map(
    rows.map((r) => [
      r.id!,
      {
        inbox: Number(r.inbox),
        sent: Number(r.sent),
        other: Number(r.other),
        meetings: Number(r.meetings),
        upcoming: Number(r.upcoming),
        lastAt: r.lastAt ? new Date(r.lastAt) : null,
        nextMeetingAt: r.nextMeetingAt ? new Date(r.nextMeetingAt) : null,
      },
    ]),
  );
}

/** E-mail/meeting counts of the last 30 days per opportunity (input of `healthScore`). */
export function opportunityEngagementCounts(db: DbOrTx, oppIds: string[], now: Date) {
  return windowCounts(db, activities.opportunityId, oppIds, now);
}

/** "WOM_IS3676" matches the legacy ref "3676" (digits at the end, not part of a longer number). */
export function ticketMatchesRef(number: string, ref: string): boolean {
  const digits = ref.replace(/\D/g, '');
  if (!digits) return false;
  return new RegExp(`(^|\\D)0*${digits}$`).test(number.trim());
}

export async function computeEngagement(db: DbOrTx, ownerIds: string[] | 'ALL', now: Date) {
  const topics = await db
    .select({ t: engagementTopics, accountName: accounts.name, ownerName: users.fullName })
    .from(engagementTopics)
    .innerJoin(accounts, eq(accounts.id, engagementTopics.accountId))
    .innerJoin(users, eq(users.id, engagementTopics.ownerUserId))
    .where(ownerIds === 'ALL' ? sql`true` : inArray(engagementTopics.ownerUserId, ownerIds));
  const counts = await windowCounts(
    db,
    activities.topicId,
    topics.map((x) => x.t.id),
    now,
  );
  const accountIds = [...new Set(topics.map((x) => x.t.accountId))];
  const ticketRows = accountIds.length
    ? await db
        .select({
          accountId: tickets.accountId,
          number: tickets.number,
          status: tickets.status,
          lastUpdateAt: tickets.lastUpdateAt,
        })
        .from(tickets)
        .where(inArray(tickets.accountId, accountIds))
    : [];
  const oppIds = topics.map((x) => x.t.opportunityId).filter((x): x is string => !!x);
  const oppNames = new Map(
    (oppIds.length
      ? await db
          .select({ id: opportunities.id, name: opportunities.name, code: opportunities.code })
          .from(opportunities)
          .where(inArray(opportunities.id, oppIds))
      : []
    ).map((o) => [o.id, o]),
  );

  const nowIso = now.toISOString();
  const byAccount = new Map<
    string,
    {
      accountId: string;
      accountName: string;
      topics: unknown[];
      inputs: Parameters<typeof accountEngagement>[0][number][];
    }
  >();
  const results = [];
  for (const { t, accountName, ownerName } of topics) {
    const c = counts.get(t.id) ?? {
      inbox: 0,
      sent: 0,
      other: 0,
      meetings: 0,
      upcoming: 0,
      lastAt: null,
      nextMeetingAt: null,
    };
    let linked: EngagementTicket[] = [];
    for (const ref of t.edoRefs) {
      const hit = ticketRows.filter(
        (k) => k.accountId === t.accountId && ticketMatchesRef(k.number, ref),
      );
      linked.push(
        ...hit.map((k) => ({
          number: k.number,
          status: k.status,
          lastUpdateAt: k.lastUpdateAt.toISOString(),
        })),
      );
    }
    // Tickets not in the CRM yet: use the eDo age the legacy dashboard saw (ADR 0008).
    if (!linked.length && t.edoLastUpdateAt) {
      linked = [
        {
          number: `IS${t.edoRefs[0] ?? ''}`,
          status: 'OPEN',
          lastUpdateAt: t.edoLastUpdateAt.toISOString(),
        },
      ];
    }
    const r = engagementScore({
      inbox: c.inbox,
      sent: c.sent,
      meetings: c.meetings,
      upcoming: c.upcoming,
      lastAt: c.lastAt ? c.lastAt.toISOString() : null,
      state: t.state,
      tickets: linked.length ? linked : undefined,
      now: nowIso,
    });
    results.push(r);
    const opp = t.opportunityId ? oppNames.get(t.opportunityId) : undefined;
    const g = byAccount.get(t.accountId) ?? {
      accountId: t.accountId,
      accountName,
      topics: [],
      inputs: [],
    };
    g.inputs.push({
      inbox: c.inbox,
      sent: c.sent,
      meetings: c.meetings,
      upcoming: c.upcoming,
      result: r,
    });
    g.topics.push({
      id: t.id,
      name: t.name,
      section: t.section,
      clientLabel: t.clientLabel,
      ownerName,
      state: t.state,
      stateReason: t.stateReason,
      edoRefs: t.edoRefs,
      opportunityId: t.opportunityId,
      opportunityCode: opp?.code ?? null,
      opportunityName: opp?.name ?? null,
      inbox: c.inbox,
      sent: c.sent,
      meetings: c.meetings,
      upcoming: c.upcoming,
      lastAt: c.lastAt,
      nextMeetingAt: c.nextMeetingAt,
      ...r,
    });
    byAccount.set(t.accountId, g);
  }
  const accountsOut = [...byAccount.values()]
    .map((g) => ({
      accountId: g.accountId,
      accountName: g.accountName,
      ...accountEngagement(g.inputs),
      topics: (g.topics as { total: number; score: number }[]).sort(
        (a, b) => b.total - a.total || b.score - a.score,
      ),
    }))
    .sort((a, b) => b.score - a.score || b.activeCount - a.activeCount);

  // Mailbox totals: latest snapshot per owner.
  const snaps = await db
    .selectDistinctOn([mailSnapshots.userId], {
      userId: mailSnapshots.userId,
      generatedAt: mailSnapshots.generatedAt,
      windowDays: mailSnapshots.windowDays,
      inboxCount: mailSnapshots.inboxCount,
      sentCount: mailSnapshots.sentCount,
      meetingsMatched: mailSnapshots.meetingsMatched,
      upcomingMatched: mailSnapshots.upcomingMatched,
      unmatchedCount: mailSnapshots.unmatchedCount,
    })
    .from(mailSnapshots)
    .where(ownerIds === 'ALL' ? sql`true` : inArray(mailSnapshots.userId, ownerIds))
    .orderBy(mailSnapshots.userId, desc(mailSnapshots.generatedAt));
  const mailbox = snaps.length
    ? {
        mailboxes: snaps.length,
        generatedAt: snaps.reduce(
          (a, s) => (s.generatedAt < a ? s.generatedAt : a),
          snaps[0]!.generatedAt,
        ),
        windowDays: snaps[0]!.windowDays,
        emails: snaps.reduce((a, s) => a + s.inboxCount + s.sentCount, 0),
        inbox: snaps.reduce((a, s) => a + s.inboxCount, 0),
        sent: snaps.reduce((a, s) => a + s.sentCount, 0),
        meetings: snaps.reduce((a, s) => a + s.meetingsMatched, 0),
        upcoming: snaps.reduce((a, s) => a + s.upcomingMatched, 0),
        unmatched: snaps.reduce((a, s) => a + s.unmatchedCount, 0),
      }
    : null;
  return {
    asOf: nowIso,
    windowDays: ENGAGEMENT_WINDOW_DAYS,
    mailbox,
    summary: engagementSummary(results),
    accounts: accountsOut,
  };
}
