import {
  D,
  exhaustionProjection,
  HoursImportSchema,
  parseAmount,
  parseCsv,
  poConsumption,
  ResidentPoSchema,
  type CapacityAlert,
} from '@wcrm/shared';
import { asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { recordAudit, type Actor } from '../../audit/record';
import type { DbOrTx } from '../../db/client';
import {
  accounts,
  contracts,
  hoursEntries,
  hoursImports,
  residentPos,
} from '../../db/schema/index';
import { notFound, ruleViolation } from '../../lib/errors';
import { actorOf, authOf, ok } from '../../lib/http';
import { parse } from '../../lib/validate';
import type { MailTransport } from '../../services/mailer';
import { notify } from '../../services/notify';
import type { RulesContext } from '../../services/rulesContext';

const LEVEL: Record<CapacityAlert, number> = { NONE: 0, WARN_80: 1, CRITICAL_100: 2 };

/**
 * P16-02: recompute consumption per resident PO, mark hours beyond 100 % as "sin OC", and alert
 * AM + CM (task "pedir CR o renovación") when the alert level rises.
 */
export async function recomputeCapacity(
  db: DbOrTx,
  ctx: RulesContext,
  mailer?: MailTransport,
): Promise<number> {
  const pos = await db.select().from(residentPos);
  let alerts = 0;
  for (const po of pos) {
    const entries = await db
      .select()
      .from(hoursEntries)
      .where(eq(hoursEntries.poId, po.id))
      .orderBy(asc(hoursEntries.month), asc(hoursEntries.residentName));
    let cum = D(0);
    for (const e of entries) {
      const before = cum;
      cum = cum.plus(D(e.hours));
      const over = (x: ReturnType<typeof D>) =>
        x.gt(D(po.totalHours)) ? x.minus(D(po.totalHours)) : D(0);
      const excess = over(cum).minus(over(before));
      if (!D(e.excessHours).eq(excess)) {
        await db
          .update(hoursEntries)
          .set({ excessHours: excess.toFixed(2), withoutPo: excess.gt(0) })
          .where(eq(hoursEntries.id, e.id));
      }
    }
    const c = poConsumption(cum, po.totalHours, ctx.settings['capacity.poAlertPct']);
    await db
      .update(residentPos)
      .set({ consumedHours: cum.toFixed(2), alertLevel: c.alert, updatedAt: new Date() })
      .where(eq(residentPos.id, po.id));
    if (LEVEL[c.alert] > 0 && LEVEL[c.alert] >= LEVEL[po.alertLevel]) {
      alerts += await notify(
        db,
        {
          roles: ['ACCOUNT_MANAGER', 'COUNTRY_MANAGER'],
          type: 'PO_CAPACITY',
          titleKey: c.alert === 'CRITICAL_100' ? 'poCapacityCritical' : 'poCapacityWarn',
          params: {
            poNumber: po.poNumber,
            pct: Math.round(c.pct * 100),
            suggestion: 'CR_OR_RENEWAL',
          },
          entityType: 'resident_po',
          entityId: po.id,
          link: '/capacidad',
          dedupeKey: `capacity:${po.id}:${c.alert}`,
        },
        mailer,
      );
    }
  }
  return alerts;
}

/** Imports one month of ZMP hours (CSV: po_number, resident, hours); re-import replaces the month. */
export async function importHours(
  db: DbOrTx,
  ctx: RulesContext,
  actor: Actor,
  month: string,
  csv: string,
  mailer?: MailTransport,
) {
  const rows = parseCsv(csv);
  const pos = await db.select().from(residentPos);
  const report: { row: number; code: string; poNumber?: string }[] = [];
  const valid: { po: string; resident: string; hours: string; poId: string | null }[] = [];
  rows.forEach((r, i) => {
    const po = r.po_number ?? r.poNumber ?? r.OC ?? r.oc ?? '';
    const resident = r.resident ?? r.resident_name ?? r.residente ?? '';
    const hours = parseAmount(r.hours ?? r.horas ?? '');
    if (!po || !resident || !hours) {
      report.push({ row: i + 2, code: 'ROW_INVALID' });
      return;
    }
    const match = pos.find((p) => p.poNumber === po);
    if (!match) report.push({ row: i + 2, code: 'PO_NOT_FOUND', poNumber: po });
    valid.push({ po, resident, hours, poId: match?.id ?? null });
  });
  const [imp] = await db
    .insert(hoursImports)
    .values({
      month,
      rowsOk: valid.length,
      rowsError: rows.length - valid.length,
      report,
      createdBy: actor.userId,
    })
    .returning();
  await db.delete(hoursEntries).where(eq(hoursEntries.month, month));
  if (valid.length) {
    await db.insert(hoursEntries).values(
      valid.map((v) => ({
        importId: imp!.id,
        month,
        poId: v.poId,
        poNumberRaw: v.po,
        residentName: v.resident,
        hours: v.hours,
        withoutPo: v.poId === null,
        excessHours: v.poId === null ? v.hours : '0',
      })),
    );
  }
  const alerts = await recomputeCapacity(db, ctx, mailer);
  await recordAudit(db, actor, {
    action: 'IMPORT',
    category: 'DATA',
    entityType: 'hours_import',
    entityId: imp!.id,
    changes: [
      { field: 'month', old: null, new: month },
      { field: 'rows', old: null, new: valid.length },
    ],
  });
  return {
    importId: imp!.id,
    rowsOk: valid.length,
    rowsError: rows.length - valid.length,
    report,
    alerts,
  };
}

/** P16 resident capacity: PO balance vs ZMP hours, 80 % alert, hours without PO. */
export async function capacityRoutes(app: FastifyInstance) {
  const { db, rules, mailer } = app.ctx;

  app.get('/resident-pos', { config: { guard: { process: 'P16', action: 'view' } } }, async () => {
    const ctx = await rules.get();
    const pos = await db
      .select({ p: residentPos, accountName: accounts.name, contractTitle: contracts.title })
      .from(residentPos)
      .innerJoin(accounts, eq(accounts.id, residentPos.accountId))
      .innerJoin(contracts, eq(contracts.id, residentPos.contractId));
    const monthly = await db
      .select({
        poId: hoursEntries.poId,
        month: hoursEntries.month,
        hours: sql<string>`sum(${hoursEntries.hours})::text`,
      })
      .from(hoursEntries)
      .groupBy(hoursEntries.poId, hoursEntries.month)
      .orderBy(asc(hoursEntries.month));
    return ok(
      pos.map((x) => {
        const series = monthly.filter((m) => m.poId === x.p.id);
        const c = poConsumption(
          x.p.consumedHours,
          x.p.totalHours,
          ctx.settings['capacity.poAlertPct'],
        );
        return {
          ...x.p,
          accountName: x.accountName,
          contractTitle: x.contractTitle,
          ...c,
          monthly: series.map((s) => ({ month: s.month, hours: s.hours })),
          monthsToExhaustion: exhaustionProjection(
            series.map((s) => s.hours),
            c.remainingHours,
          ),
        };
      }),
    );
  });

  app.post(
    '/resident-pos',
    { config: { guard: { process: 'P16', action: 'write' } } },
    async (req, reply) => {
      const body = parse(ResidentPoSchema, req.body);
      const [c] = await db.select().from(contracts).where(eq(contracts.id, body.contractId));
      if (!c) throw notFound();
      if (c.type !== 'OC') throw ruleViolation([{ code: 'CONTRACT_NOT_PO' }]);
      const row = await db.transaction(async (tx) => {
        const [p] = await tx
          .insert(residentPos)
          .values({
            ...body,
            accountId: c.accountId,
            validFrom: body.validFrom ?? null,
            validTo: body.validTo ?? null,
            createdBy: authOf(req).user.id,
          })
          .returning();
        await recordAudit(tx, actorOf(req), {
          action: 'CREATE',
          category: 'DATA',
          entityType: 'resident_po',
          entityId: p!.id,
          accountId: c.accountId,
        });
        return p;
      });
      return reply.status(201).send(ok(row));
    },
  );

  app.post(
    '/resident-pos/hours-imports',
    {
      bodyLimit: 5_242_880,
      config: { guard: { process: 'P16', action: 'write', actionRole: 'P16.hours.import' } },
    },
    async (req) => {
      const body = parse(HoursImportSchema, req.body);
      const ctx = await rules.get();
      return ok(
        await db.transaction((tx) =>
          importHours(tx, ctx, actorOf(req), body.month, body.csv, mailer),
        ),
      );
    },
  );

  app.get(
    '/reports/hours-without-po',
    { config: { guard: { process: 'P16', action: 'view' } } },
    async () =>
      ok(
        await db
          .select({
            month: hoursEntries.month,
            poNumber: hoursEntries.poNumberRaw,
            residentName: hoursEntries.residentName,
            hours: hoursEntries.hours,
            excessHours: hoursEntries.excessHours,
          })
          .from(hoursEntries)
          .where(eq(hoursEntries.withoutPo, true))
          .orderBy(asc(hoursEntries.month)),
      ),
  );
}
