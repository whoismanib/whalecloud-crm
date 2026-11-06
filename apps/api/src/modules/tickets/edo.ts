/**
 * eDo incidents panel (legacy "Incidentes eDo" tab) and the direct eDo sync behind "Actualizar"
 * (ADR 0007). The KPIs are computed here with the shared port of `edo_logic.js`, so every user
 * sees the same numbers as the legacy dashboard.
 */
import {
  EDO_DEFAULT_CONFIG,
  edoAgingBuckets,
  edoEnrich,
  edoGroupSummary,
  edoKpis,
  edoPushGroups,
  edoReminderWhale,
  edoReminderWom,
  edoTrends,
  edoWomPending,
  type EdoEnriched,
  type EdoRecord,
} from '@wcrm/shared';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { recordAudit, type Actor } from '../../audit/record';
import { importJobs, tickets } from '../../db/schema/index';
import { AppError } from '../../lib/errors';
import { actorOf, ok } from '../../lib/http';
import { EdoError, fetchEdoIncidents } from '../../services/edoClient';
import { importEdoIncidents, inTx } from '../imports/service';

const DAY = 86_400_000;

interface SyncState {
  busy: boolean;
  startedAt: string | null;
  progress: { done: number; total: number; label: string } | null;
  lastError: { code: string; message: string; at: string } | null;
  lastOk: {
    at: string;
    mode: 'quick' | 'full' | 'fixture';
    total: number;
    created: number;
    updated: number;
    warning: string | null;
  } | null;
}
/** One sync at a time per API process (a second click gets 409). */
const state: SyncState = {
  busy: false,
  startedAt: null,
  progress: null,
  lastError: null,
  lastOk: null,
};

/** Row of the incidents table: the eDo record plus the computed fields the UI shows. */
function row(e: EdoEnriched, cfg = EDO_DEFAULT_CONFIG) {
  return {
    id: e.id,
    no: e.no,
    title: e.title,
    priority: e.priority,
    status: e.status,
    statusName: e.statusName ?? '',
    org: e.org ?? '',
    side: e.side ?? '',
    assignee: e.assignee ?? '',
    creator: e.creator ?? '',
    coordinator: e.coordinator ?? '',
    created: e.created,
    updated: e.updated ?? null,
    firstOpr: e.firstOpr ?? null,
    comment: e.comment ?? '',
    link: e.link || cfg.ticketUrl.replace('{issueId}', encodeURIComponent(e.id)),
    open: e._open,
    ball: e._ball,
    ageDays: e._ageDays,
    closedAt: e._closeMs == null ? null : new Date(e._closeMs).toISOString(),
    respHours: e._respH,
    stale: { ...e._stale, lastAct: e._stale.lastAct && new Date(e._stale.lastAct).toISOString() },
    sla: e._sla,
    reminder: e._open
      ? e._ball.who === 'WOM'
        ? edoReminderWom(e, cfg)
        : edoReminderWhale(e, cfg)
      : null,
  };
}

export async function edoRoutes(app: FastifyInstance) {
  const { db, config } = app.ctx;
  const cfg = EDO_DEFAULT_CONFIG;

  /** Panel: open + resolved + closed in the last 100 days, KPIs, push groups and trends. */
  app.get('/tickets/edo', { config: { guard: { process: 'P10', action: 'view' } } }, async () => {
    const now = Date.now();
    const rows = await db
      .select({ edo: tickets.edo })
      .from(tickets)
      .where(and(eq(tickets.externalSource, 'EDO'), isNotNull(tickets.edo)));
    const all = rows.map((r) => r.edo as EdoRecord);
    const cutoff = now - cfg.closedDays * DAY;
    const en = edoEnrich(all, now, cfg).filter(
      (e) => e._open || e.status === 4 || (e._closeMs != null && e._closeMs >= cutoff),
    );
    const groups = edoPushGroups(en);
    const [job] = await db
      .select({ at: importJobs.createdAt, report: importJobs.report })
      .from(importJobs)
      .where(and(eq(importJobs.kind, 'EDO_INCIDENTS'), eq(importJobs.dryRun, false)))
      .orderBy(desc(importJobs.createdAt))
      .limit(1);
    return ok({
      now: new Date(now).toISOString(),
      meta: {
        // Freshness of the eDo data: the file's generated_at, or the time of the direct sync.
        lastSyncAt:
          (job?.report as { generatedAt?: string } | null)?.generatedAt ??
          job?.at?.toISOString() ??
          null,
        source: (job?.report as { source?: string } | null)?.source ?? null,
        totalInCrm: all.length,
        shown: en.length,
        closedDays: cfg.closedDays,
        sync: {
          configured: !!config.EDO_ACCESS_TOKEN?.trim() || !!config.EDO_FIXTURE,
          fixture: !!config.EDO_FIXTURE,
        },
      },
      kpis: edoKpis(en, now),
      groups: groups.map((g) => ({
        name: g.name,
        team: g.team,
        person: g.person,
        breached: g.breached,
        ids: g.items.map((e) => e.id),
        summary: edoGroupSummary(g, cfg),
      })),
      womPending: edoWomPending(en).map((e) => e.id),
      trends: edoTrends(en, now, cfg),
      aging: edoAgingBuckets(en, now),
      items: en.map((e) => row(e, cfg)),
    });
  });

  app.get(
    '/tickets/edo/status',
    { config: { guard: { process: 'P10', action: 'view' } } },
    async () => ok(state),
  );

  /** "Actualizar": downloads from eDo in the background; poll /tickets/edo/status. */
  app.post(
    '/tickets/edo/refresh',
    { config: { guard: { process: 'P10', action: 'view' } } },
    async (req, reply) => {
      const full = (req.query as { full?: string } | undefined)?.full === '1';
      if (state.busy) throw new AppError(409, 'EDO_SYNC_BUSY');
      if (!config.EDO_ACCESS_TOKEN?.trim() && !config.EDO_FIXTURE)
        throw new AppError(409, 'EDO_SYNC_NOT_CONFIGURED');
      state.busy = true;
      state.startedAt = new Date().toISOString();
      state.progress = { done: 0, total: 3, label: '' };
      state.lastError = null;
      void runSync(actorOf(req), full).finally(() => {
        state.busy = false;
        state.progress = null;
      });
      return reply.status(202).send(ok({ started: true }));
    },
  );

  async function runSync(actor: Actor, full: boolean) {
    try {
      const prev = await db
        .select({ edo: tickets.edo })
        .from(tickets)
        .where(and(eq(tickets.externalSource, 'EDO'), isNotNull(tickets.edo)));
      const prevOpen = new Map<string, number>();
      for (const { edo } of prev) {
        const e = edo as EdoRecord;
        if (e.open || e.status === 4) prevOpen.set(e.id, Date.parse(e.created ?? '2000-01-01'));
      }
      const res = await fetchEdoIncidents(
        {
          token: config.EDO_ACCESS_TOKEN,
          baseUrl: config.EDO_BASE_URL,
          projectId: config.EDO_PROJECT_ID,
          issueType: config.EDO_ISSUE_TYPE,
          fixture: config.EDO_FIXTURE,
        },
        {
          // Quick mode needs a previous full download in the CRM.
          prevOpen: full || prev.length === 0 ? null : prevOpen,
          now: Date.now(),
          progress: (done, total, label) => (state.progress = { done, total, label }),
        },
      );
      const expected = Object.values(res.totals).reduce((a, b) => a + b, 0);
      const warning =
        res.source !== 'fixture' && expected && res.incidents.length < expected
          ? `Se recibieron ${res.incidents.length} de ${expected} tickets (la paginación pudo cambiar durante la descarga).`
          : null;
      const report = await inTx(db, false, (tx) =>
        importEdoIncidents(
          tx,
          actor,
          { incidents: res.incidents },
          { accountName: config.EDO_ACCOUNT_NAME, timeZone: config.APP_TIMEZONE },
        ),
      );
      const mode = res.source === 'fixture' ? 'fixture' : res.quick ? 'quick' : 'full';
      const [job] = await db
        .insert(importJobs)
        .values({
          kind: 'EDO_INCIDENTS',
          dryRun: false,
          rowsTotal: report.rowsTotal,
          rowsOk: report.rowsOk,
          rowsError: report.errors.length,
          report: {
            source: res.source,
            mode,
            totals: res.totals,
            warning,
            created: report.created,
            updated: report.updated,
            skipped: report.skipped,
            errors: report.errors,
            warnings: report.warnings,
          },
          createdBy: actor.userId,
        })
        .returning({ id: importJobs.id });
      await recordAudit(db, actor, {
        action: 'IMPORT',
        category: 'DATA',
        entityType: 'import_job',
        entityId: job!.id,
        changes: [
          {
            field: 'edo-sync',
            old: null,
            new: { mode, ...report.created, updated: report.updated, errors: report.errors.length },
          },
        ],
      });
      const upd = report.updated ?? {};
      state.lastOk = {
        at: new Date().toISOString(),
        mode,
        total: res.incidents.length,
        created: report.created.tickets ?? 0,
        updated: (upd.tickets ?? 0) + (upd.ticketsLinked ?? 0),
        warning,
      };
    } catch (e) {
      const err =
        e instanceof EdoError
          ? { code: e.code, message: e.message }
          : { code: 'internal', message: 'Error interno al actualizar desde eDo.' };
      if (!(e instanceof EdoError)) app.log.error({ err: e }, 'edo sync failed');
      state.lastError = { ...err, at: new Date().toISOString() };
    }
  }
}
