import {
  cadenceStep,
  categoryWarnings,
  forecastAccuracy,
  forecastTotals,
  ForecastUpdateSchema,
  isoWeek,
  previousFriday,
  quarterRange,
  quarterStart,
  ssSigned,
  stageProbability,
  weekOverWeekChanges,
  type ForecastItem,
} from '@wcrm/shared';
import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recordAudit, type Actor } from '../../audit/record';
import type { Db } from '../../db/client';
import {
  accounts,
  contracts,
  forecastSnapshotItems,
  forecastSnapshots,
  opportunities,
  users,
} from '../../db/schema/index';
import { conflict, notFound } from '../../lib/errors';
import { actorOf, authOf, ok } from '../../lib/http';
import { parse } from '../../lib/validate';
import { assertVisible, lockOpportunity } from '../../services/opportunities';
import type { RulesContext } from '../../services/rulesContext';
import type { AuthInfo } from '../../types';
import { computeDashboard } from '../dashboard/routes';

async function currentItems(db: Db) {
  return db
    .select({
      opportunityId: opportunities.id,
      name: opportunities.name,
      accountName: accounts.name,
      ownerId: opportunities.ownerId,
      ownerName: users.fullName,
      stage: opportunities.stage,
      status: opportunities.status,
      forecastCategory: opportunities.forecastCategory,
      customerType: accounts.customerType,
      amount: sql<string>`coalesce(${opportunities.amountCny}, 0)::text`,
      amountUsd: opportunities.amountUsd,
      expectedCloseDate: opportunities.expectedCloseDate,
      updatedAt: opportunities.updatedAt,
      lastActivityAt: opportunities.lastActivityAt,
    })
    .from(opportunities)
    .innerJoin(accounts, eq(accounts.id, opportunities.accountId))
    .innerJoin(users, eq(users.id, opportunities.ownerId))
    .where(sql`${opportunities.archivedAt} IS NULL`);
}

/** Freezes the weekly snapshot (P12-03): items + totals + KPIs, immutable by trigger. */
export async function takeSnapshot(
  db: Db,
  ctx: RulesContext,
  auth: AuthInfo | null,
  actor: Actor,
  today: string,
): Promise<string> {
  const w = isoWeek(today);
  const [existing] = await db
    .select({ id: forecastSnapshots.id })
    .from(forecastSnapshots)
    .where(
      and(
        eq(forecastSnapshots.isoYear, w.year),
        eq(forecastSnapshots.isoWeek, w.week),
        eq(forecastSnapshots.countryCode, 'CL'),
      ),
    );
  if (existing)
    throw conflict('DUPLICATE', [{ code: 'SNAPSHOT_EXISTS', params: { week: w.week } }]);
  const items = await currentItems(db);
  const probs = ctx.settings['forecast.stageProbabilities'];
  const q = quarterStart(today);
  const qr = quarterRange(`${q.slice(0, 4)}Q${Math.floor(Number(q.slice(5, 7)) / 3) + 1}`);
  const totals = {
    quarter: { ...qr, ...forecastTotals(items, probs, qr.from, qr.to) },
    year: forecastTotals(items, probs, `${today.slice(0, 4)}-01-01`, `${today.slice(0, 4)}-12-31`),
    currency: 'CNY',
  };
  const kpis = auth ? (await computeDashboard(db, ctx, auth, today, { currency: 'CNY' })).kpis : [];
  return db.transaction(async (tx) => {
    const [snap] = await tx
      .insert(forecastSnapshots)
      .values({
        isoYear: w.year,
        isoWeek: w.week,
        countryCode: 'CL',
        takenOn: today,
        takenBy: actor.userId,
        totals,
        kpis,
      })
      .returning();
    const open = items.filter((i) => i.status === 'OPEN' || i.stage >= 7);
    if (open.length) {
      await tx.insert(forecastSnapshotItems).values(
        open.map((i) => ({
          snapshotId: snap!.id,
          opportunityId: i.opportunityId,
          name: i.name,
          accountName: i.accountName,
          ownerId: i.ownerId,
          stage: i.stage,
          status: i.status,
          forecastCategory: i.forecastCategory,
          customerType: i.customerType,
          amountCny: i.amount,
          amountUsd: i.amountUsd,
          expectedCloseDate: i.expectedCloseDate,
          probability: String(stageProbability(i.stage, probs)),
        })),
      );
    }
    await recordAudit(tx, actor, {
      action: 'SNAPSHOT',
      category: 'DATA',
      entityType: 'forecast_snapshot',
      entityId: snap!.id,
      changes: [{ field: 'week', old: null, new: `${w.year}-W${w.week}` }],
    });
    return snap!.id;
  });
}

const toItem = (i: typeof forecastSnapshotItems.$inferSelect): ForecastItem => ({
  opportunityId: i.opportunityId,
  stage: i.stage,
  status: i.status,
  forecastCategory: i.forecastCategory,
  amount: i.amountCny ?? '0',
  expectedCloseDate: i.expectedCloseDate,
});

/** P12-05 accuracy for a quarter: first snapshot of the period vs S&S signed (also DASH-05). */
export async function forecastAccuracyFor(db: Db, ctx: RulesContext, period: string) {
  const { from, to } = quarterRange(period);
  const [snap] = await db
    .select()
    .from(forecastSnapshots)
    .where(lte(forecastSnapshots.takenOn, to))
    .orderBy(sql`abs(${forecastSnapshots.takenOn} - ${from}::date)`, asc(forecastSnapshots.takenOn))
    .limit(1);
  const items = snap
    ? await db
        .select()
        .from(forecastSnapshotItems)
        .where(eq(forecastSnapshotItems.snapshotId, snap.id))
    : [];
  const forecast = forecastTotals(
    items.map(toItem),
    ctx.settings['forecast.stageProbabilities'],
    from,
    to,
  ).commitPlusProbable;
  const rows = await db
    .select({
      type: contracts.type,
      countsForSs: contracts.countsForSs,
      signedOn: contracts.signedOn,
      amount: sql<string>`coalesce(${contracts.amountCny},0)::text`,
      stage: opportunities.stage,
      status: opportunities.status,
      customerTypeFrozen: opportunities.customerTypeFrozen,
      countsAsDigital: opportunities.countsAsDigital,
    })
    .from(contracts)
    .innerJoin(opportunities, eq(opportunities.id, contracts.opportunityId))
    .where(inArray(contracts.status, ['SIGNED', 'ACTIVE', 'EXPIRED']));
  const actual = ssSigned(
    rows.map((r) => ({ ...r, opportunityWon: r.stage >= 7 && r.status === 'OPEN' })),
    from,
    to,
  ).total;
  return {
    period,
    snapshotId: snap?.id ?? null,
    snapshotOn: snap?.takenOn ?? null,
    forecast,
    actual,
    ...forecastAccuracy(actual, forecast, ctx.settings['forecast.accuracyTolerance']),
  };
}

/** P12 forecast: categories, cadence Mon/Tue/Wed, weekly snapshot, changes and accuracy. */
export async function forecastRoutes(app: FastifyInstance) {
  const { db, rules } = app.ctx;
  const idParam = z.object({ id: z.string().uuid() });

  app.patch(
    '/opportunities/:id/forecast',
    { config: { guard: { process: 'P12', action: 'write' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const body = parse(ForecastUpdateSchema, req.body);
      const ctx = await rules.get();
      const row = await db.transaction(async (tx) => {
        const o = await lockOpportunity(tx, id);
        await assertVisible(tx, authOf(req), o, ctx.raci);
        const [after] = await tx
          .update(opportunities)
          .set({
            forecastCategory: body.forecastCategory,
            updatedAt: new Date(),
            rowVersion: o.rowVersion + 1,
          })
          .where(eq(opportunities.id, id))
          .returning();
        await recordAudit(tx, actorOf(req), {
          action: 'UPDATE',
          category: 'DATA',
          entityType: 'opportunity',
          entityId: id,
          opportunityId: id,
          changes: [
            { field: 'forecastCategory', old: o.forecastCategory, new: body.forecastCategory },
          ],
        });
        return after!;
      });
      return {
        data: row,
        meta: {
          warnings: categoryWarnings(
            row.stage,
            row.forecastCategory,
            ctx.settings['forecast.commitMinStage'],
          ),
        },
      };
    },
  );

  app.get(
    '/forecast/current',
    { config: { guard: { process: 'P12', action: 'view' } } },
    async (req) => {
      const q = parse(
        z.object({ from: z.string().optional(), to: z.string().optional() }),
        req.query,
      );
      const ctx = await rules.get();
      const from = q.from ?? `${req.today.slice(0, 4)}-01-01`;
      const to = q.to ?? `${req.today.slice(0, 4)}-12-31`;
      const items = await currentItems(db);
      const probs = ctx.settings['forecast.stageProbabilities'];
      const owners = [...new Set(items.map((i) => i.ownerId))];
      const friday = previousFriday(req.today);
      const commitMin = ctx.settings['forecast.commitMinStage'];
      return ok({
        from,
        to,
        cadence: cadenceStep(req.today),
        totals: forecastTotals(items, probs, from, to),
        byOwner: owners.map((o) => ({
          ownerId: o,
          ownerName: items.find((i) => i.ownerId === o)?.ownerName,
          ...forecastTotals(
            items.filter((i) => i.ownerId === o),
            probs,
            from,
            to,
          ),
        })),
        items: items
          .filter(
            (i) =>
              i.status === 'OPEN' &&
              i.stage <= 7 &&
              i.expectedCloseDate >= from &&
              i.expectedCloseDate <= to,
          )
          .map((i) => {
            const last = [
              i.updatedAt.toISOString().slice(0, 10),
              i.lastActivityAt?.toISOString().slice(0, 10) ?? '',
            ]
              .sort()
              .at(-1)!;
            return {
              ...i,
              probability: stageProbability(i.stage, probs),
              warnings: categoryWarnings(i.stage, i.forecastCategory, commitMin),
              stale: i.stage >= 1 && last <= friday,
            };
          })
          .sort((a, b) => Number(b.amount) - Number(a.amount)),
      });
    },
  );

  app.post(
    '/forecast/snapshots',
    { config: { guard: { process: 'P12', action: 'approve' } } },
    async (req, reply) => {
      const id = await takeSnapshot(db, await rules.get(), authOf(req), actorOf(req), req.today);
      return reply.status(201).send(ok({ id }));
    },
  );

  app.get(
    '/forecast/snapshots',
    { config: { guard: { process: 'P12', action: 'view' } } },
    async () =>
      ok(
        await db
          .select()
          .from(forecastSnapshots)
          .orderBy(desc(forecastSnapshots.takenOn))
          .limit(104),
      ),
  );

  app.get(
    '/forecast/snapshots/:id',
    { config: { guard: { process: 'P12', action: 'view' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const [s] = await db.select().from(forecastSnapshots).where(eq(forecastSnapshots.id, id));
      if (!s) throw notFound();
      const items = await db
        .select()
        .from(forecastSnapshotItems)
        .where(eq(forecastSnapshotItems.snapshotId, id))
        .orderBy(desc(forecastSnapshotItems.amountCny));
      return ok({ ...s, items });
    },
  );

  /** P12-06: week-over-week changes between two snapshots (default: the last two). */
  app.get(
    '/forecast/changes',
    { config: { guard: { process: 'P12', action: 'view' } } },
    async (req) => {
      const q = parse(
        z.object({ from: z.string().uuid().optional(), to: z.string().uuid().optional() }),
        req.query,
      );
      let ids = [q.from, q.to].filter(Boolean) as string[];
      if (ids.length < 2) {
        const last = await db
          .select({ id: forecastSnapshots.id })
          .from(forecastSnapshots)
          .orderBy(desc(forecastSnapshots.takenOn))
          .limit(2);
        ids = last.map((l) => l.id).reverse();
      }
      if (ids.length < 2) return ok({ changes: [] });
      const items = await db
        .select()
        .from(forecastSnapshotItems)
        .where(inArray(forecastSnapshotItems.snapshotId, ids));
      const prev = items.filter((i) => i.snapshotId === ids[0]);
      const curr = items.filter((i) => i.snapshotId === ids[1]);
      const names = new Map(items.map((i) => [i.opportunityId, i.name]));
      return ok({
        fromId: ids[0],
        toId: ids[1],
        changes: weekOverWeekChanges(prev.map(toItem), curr.map(toItem)).map((c) => ({
          ...c,
          name: names.get(c.opportunityId),
        })),
      });
    },
  );

  /**
   * P12-05: forecast (commit + probable closing in the period) from the first snapshot of the
   * period vs actual S&S signed in the period; target ±10 % ⚙.
   */
  app.get(
    '/forecast/accuracy',
    { config: { guard: { process: 'P12', action: 'view' } } },
    async (req) => {
      const { period } = parse(z.object({ period: z.string().regex(/^\d{4}Q[1-4]$/) }), req.query);
      return ok(await forecastAccuracyFor(db, await rules.get(), period));
    },
  );

  /** Weekly report view (P12-04): latest (or given) snapshot + changes vs previous week. */
  app.get(
    '/forecast/report',
    { config: { guard: { process: 'P12', action: 'view' } } },
    async (req) => {
      const q = parse(z.object({ snapshotId: z.string().uuid().optional() }), req.query);
      const snaps = await db
        .select()
        .from(forecastSnapshots)
        .orderBy(desc(forecastSnapshots.takenOn))
        .limit(60);
      const idx = q.snapshotId ? snaps.findIndex((s) => s.id === q.snapshotId) : 0;
      const snap = snaps[idx];
      if (!snap) return ok(null);
      const prev = snaps[idx + 1];
      const items = await db
        .select()
        .from(forecastSnapshotItems)
        .where(inArray(forecastSnapshotItems.snapshotId, prev ? [snap.id, prev.id] : [snap.id]));
      const cur = items.filter((i) => i.snapshotId === snap.id);
      const names = new Map(items.map((i) => [i.opportunityId, i.name]));
      return ok({
        snapshot: snap,
        previousSnapshotId: prev?.id ?? null,
        topDeals: cur
          .filter((i) => i.status === 'OPEN' && i.stage < 7)
          .sort((a, b) => Number(b.amountCny) - Number(a.amountCny))
          .slice(0, 10),
        changes: prev
          ? weekOverWeekChanges(
              items.filter((i) => i.snapshotId === prev.id).map(toItem),
              cur.map(toItem),
            ).map((c) => ({
              ...c,
              name: names.get(c.opportunityId),
            }))
          : [],
      });
    },
  );
}
