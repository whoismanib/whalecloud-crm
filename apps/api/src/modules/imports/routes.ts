import {
  can,
  CsvImportSchema,
  EdoImportSchema,
  escalationStatus,
  LegacyImportSchema,
  neutralizeFormula,
  parseCsv,
  toCsv,
  type ImportKind,
} from '@wcrm/shared';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { recordAudit } from '../../audit/record';
import {
  accounts,
  importJobs,
  invoices,
  milestones,
  opportunities,
  tickets,
  users,
} from '../../db/schema/index';
import { AppError } from '../../lib/errors';
import { actorOf, authOf, ok } from '../../lib/http';
import { parse } from '../../lib/validate';
import { visibilityFilter } from '../../services/opportunities';
import { computeDashboard } from '../dashboard/routes';
import {
  importAccounts,
  importEdoIncidents,
  importInvoices,
  importLegacyTracker,
  importOpportunities,
  inTx,
  type ImportReport,
} from './service';

const KIND: Record<string, ImportKind> = {
  accounts: 'ACCOUNTS',
  opportunities: 'OPPORTUNITIES',
  invoices: 'INVOICES',
  'legacy-tracker': 'LEGACY_TRACKER',
  'edo-incidents': 'EDO_INCIDENTS',
};

/** CSV templates for the importers (first line = header). */
export const IMPORT_TEMPLATES: Record<string, string[]> = {
  accounts: [
    'name',
    'legalName',
    'taxId',
    'countryCode',
    'vertical',
    'customerType',
    'currency',
    'billingEntityCode',
    'isKeyAccount',
  ],
  opportunities: [
    'name',
    'accountName',
    'contactName',
    'vertical',
    'billingEngine',
    'origin',
    'amount',
    'currency',
    'expectedCloseDate',
    'firstContactDate',
    'stage',
    'legacyStatus',
    'forecastCategory',
    'risk',
  ],
  invoices: [
    'opportunityCode',
    'opportunityName',
    'milestoneName',
    'number',
    'issuedOn',
    'dueOn',
    'amount',
    'currency',
    'receptionOn',
    'paidAmount',
    'paidOn',
  ],
};

async function send(
  reply: FastifyReply,
  name: string,
  format: 'csv' | 'xlsx',
  rows: Record<string, unknown>[],
  columns: string[],
) {
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === 'csv') {
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${name}_${stamp}.csv"`)
      .send(toCsv(rows, columns));
  }
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CRM WhaleCloud LatAm';
  const ws = wb.addWorksheet(name.slice(0, 31));
  ws.columns = columns.map((c) => ({
    header: c,
    key: c,
    width: Math.min(40, Math.max(12, c.length + 2)),
  }));
  for (const r of rows) {
    ws.addRow(
      Object.fromEntries(
        columns.map((c) => {
          const v = r[c];
          return [
            c,
            neutralizeFormula(
              v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v,
            ),
          ];
        }),
      ),
    );
  }
  ws.getRow(1).font = { bold: true };
  const buf = await wb.xlsx.writeBuffer();
  return reply
    .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    .header('Content-Disposition', `attachment; filename="${name}_${stamp}.xlsx"`)
    .send(Buffer.from(buf));
}

/** Imports (CORE-08, legacy tracker, legacy eDo incidents) and CSV/XLSX exports of the main lists (DASH-08). */
export async function importExportRoutes(app: FastifyInstance) {
  const { db, rules } = app.ctx;

  function assertImporter(req: FastifyRequest, raci: Parameters<typeof can>[3]) {
    const roles = authOf(req).roles;
    if (!can(roles, 'P1', 'approve', raci) && !can(roles, 'ADM', 'write', raci))
      throw new AppError(403, 'FORBIDDEN');
  }

  app.get('/imports', { config: { session: true } }, async (req) => {
    assertImporter(req, (await rules.get()).raci);
    return ok(await db.select().from(importJobs).orderBy(desc(importJobs.createdAt)).limit(50));
  });

  app.get('/imports/templates/:kind', { config: { session: true } }, async (req, reply) => {
    const { kind } = parse(
      z.object({ kind: z.enum(['accounts', 'opportunities', 'invoices']) }),
      req.params,
    );
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="plantilla_${kind}.csv"`)
      .send(toCsv([], IMPORT_TEMPLATES[kind]!));
  });

  app.post(
    '/imports/:kind',
    {
      bodyLimit: 10_485_760,
      config: { session: true, guard: { process: 'P1', action: 'view', extra: 'P1:A or ADM:R' } },
    },
    async (req) => {
      const { kind } = parse(
        z.object({
          kind: z.enum([
            'accounts',
            'opportunities',
            'invoices',
            'legacy-tracker',
            'edo-incidents',
          ]),
        }),
        req.params,
      );
      const ctx = await rules.get();
      assertImporter(req, ctx.raci);
      const actor = actorOf(req);
      let dryRun = false;
      /** When the source data was produced (eDo file `generated_at`), shown as data freshness. */
      let generatedAt: string | null = null;
      let run: (tx: Parameters<typeof importAccounts>[0]) => Promise<ImportReport>;
      if (kind === 'legacy-tracker') {
        const body = parse(LegacyImportSchema, req.body);
        dryRun = body.dryRun;
        run = (tx) => importLegacyTracker(tx, ctx, actor, req.today, body.data);
      } else if (kind === 'edo-incidents') {
        const body = parse(EdoImportSchema, req.body);
        dryRun = body.dryRun;
        const g = (body.data as { generated_at?: unknown }).generated_at;
        generatedAt = typeof g === 'string' && !Number.isNaN(Date.parse(g)) ? g : null;
        run = (tx) =>
          importEdoIncidents(tx, actor, body.data, {
            accountId: body.accountId,
            accountName: body.accountName,
            timeZone: app.ctx.config.APP_TIMEZONE,
          });
      } else {
        const body = parse(CsvImportSchema, req.body);
        dryRun = body.dryRun;
        const rows = parseCsv(body.csv);
        run =
          kind === 'accounts'
            ? (tx) => importAccounts(tx, actor, rows)
            : kind === 'opportunities'
              ? (tx) => importOpportunities(tx, ctx, actor, req.today, rows)
              : (tx) => importInvoices(tx, ctx, actor, rows);
      }
      const report = await inTx(db, dryRun, run);
      const [job] = await db
        .insert(importJobs)
        .values({
          kind: KIND[kind]!,
          dryRun,
          rowsTotal: report.rowsTotal,
          rowsOk: report.rowsOk,
          rowsError: report.errors.length,
          report: {
            ...(generatedAt && { source: 'file', generatedAt }),
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
            field: kind,
            old: null,
            new: {
              ...report.created,
              ...(report.updated && { updated: report.updated }),
              errors: report.errors.length,
              dryRun,
            },
          },
        ],
      });
      return ok({ id: job!.id, dryRun, ...report });
    },
  );

  app.get('/exports/:entity', { config: { session: true } }, async (req, reply) => {
    const { entity } = parse(
      z.object({
        entity: z.enum(['accounts', 'opportunities', 'invoices', 'tickets', 'dashboard']),
      }),
      req.params,
    );
    const { format } = parse(
      z.object({ format: z.enum(['csv', 'xlsx']).default('csv') }),
      req.query,
    );
    const ctx = await rules.get();
    const auth = authOf(req);
    const need = {
      accounts: 'P1',
      opportunities: 'P1',
      invoices: 'P8',
      tickets: 'P10',
      dashboard: 'DASH',
    } as const;
    if (entity !== 'opportunities' && !can(auth.roles, need[entity], 'view', ctx.raci))
      throw new AppError(403, 'FORBIDDEN');
    let rows: Record<string, unknown>[] = [];
    let cols: string[] = [];
    if (entity === 'accounts') {
      rows = await db
        .select()
        .from(accounts)
        .where(sql`${accounts.archivedAt} IS NULL`)
        .orderBy(asc(accounts.name));
      cols = [
        'name',
        'legalName',
        'taxId',
        'countryCode',
        'vertical',
        'customerType',
        'currency',
        'isKeyAccount',
        'newWorkSuspended',
        'createdAt',
      ];
    } else if (entity === 'opportunities') {
      rows = await db
        .select({
          code: opportunities.code,
          name: opportunities.name,
          account: accounts.name,
          owner: users.fullName,
          stage: opportunities.stage,
          status: opportunities.status,
          legacyStatus: opportunities.legacyStatus,
          billingEngine: opportunities.billingEngine,
          vertical: opportunities.vertical,
          amount: opportunities.amount,
          currency: opportunities.amountCurrency,
          amountUsd: opportunities.amountUsd,
          amountCny: opportunities.amountCny,
          expectedCloseDate: opportunities.expectedCloseDate,
          forecastCategory: opportunities.forecastCategory,
          risk: opportunities.risk,
          approvedNetMargin: opportunities.approvedNetMargin,
          approvalExpiresOn: opportunities.approvalExpiresOn,
        })
        .from(opportunities)
        .innerJoin(accounts, eq(accounts.id, opportunities.accountId))
        .innerJoin(users, eq(users.id, opportunities.ownerId))
        .where(and(visibilityFilter(auth, ctx.raci), sql`${opportunities.archivedAt} IS NULL`))
        .orderBy(asc(opportunities.code));
      cols = Object.keys(rows[0] ?? { code: 1, name: 1, account: 1, stage: 1, status: 1 });
    } else if (entity === 'invoices') {
      const inv = await db
        .select({ i: invoices, account: accounts.name, milestone: milestones.name })
        .from(invoices)
        .innerJoin(accounts, eq(accounts.id, invoices.accountId))
        .innerJoin(milestones, eq(milestones.id, invoices.milestoneId))
        .orderBy(asc(invoices.dueOn));
      rows = inv.map((x) => {
        const e = escalationStatus(
          { dueOn: x.i.dueOn, balance: x.i.balance },
          req.today,
          ctx.settings,
        );
        return {
          number: x.i.number,
          account: x.account,
          milestone: x.milestone,
          issuedOn: x.i.issuedOn,
          dueOn: x.i.dueOn,
          amount: x.i.amount,
          currency: x.i.amountCurrency,
          balance: x.i.balance,
          status: x.i.status,
          daysOverdue: e.daysOverdue,
          bucket: e.bucket,
          escalationStep: e.currentStep,
        };
      });
      cols = [
        'number',
        'account',
        'milestone',
        'issuedOn',
        'dueOn',
        'amount',
        'currency',
        'balance',
        'status',
        'daysOverdue',
        'bucket',
        'escalationStep',
      ];
    } else if (entity === 'tickets') {
      rows = await db
        .select({
          number: tickets.number,
          account: accounts.name,
          title: tickets.title,
          priority: tickets.priority,
          status: tickets.status,
          ballIn: tickets.ballIn,
          orgHolder: tickets.orgHolder,
          ownerName: tickets.ownerName,
          slaDueOn: tickets.slaDueOn,
          openedOn: tickets.openedOn,
          closedOn: tickets.closedOn,
        })
        .from(tickets)
        .innerJoin(accounts, eq(accounts.id, tickets.accountId))
        .orderBy(asc(tickets.openedOn));
      cols = Object.keys(rows[0] ?? { number: 1, account: 1, title: 1 });
    } else {
      const d = await computeDashboard(db, ctx, auth, req.today, req.query);
      rows = [
        ...d.kpis.map((k) => ({
          section: 'KPI',
          code: k.code,
          value: k.value,
          target: k.target,
          rag: k.rag,
          unit: k.unit,
          detail: k.detail ?? null,
        })),
        ...Object.entries(d.legacy).map(([code, value]) => ({
          section: 'LEGACY',
          code,
          value,
          target: null,
          rag: null,
          unit: null,
          detail: null,
        })),
        ...d.charts.funnel.map((f) => ({
          section: 'FUNNEL',
          code: f.step,
          value: f.amountMm,
          target: null,
          rag: null,
          unit: 'MM',
          detail: null,
        })),
      ];
      cols = ['section', 'code', 'value', 'target', 'rag', 'unit', 'detail'];
    }
    await recordAudit(db, actorOf(req), {
      action: 'EXPORT',
      category: 'EXPORT',
      entityType: entity,
      entityId: format,
      changes: [{ field: 'rows', old: null, new: rows.length }],
    });
    return send(reply, entity, format, rows, cols);
  });
}
