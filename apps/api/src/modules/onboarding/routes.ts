import {
  addDays,
  daysToFirstOpportunity,
  ONBOARDING_ITEMS,
  OnboardingCreateSchema,
  OnboardingItemSchema,
  OnboardingKitSchema,
  onboardingOverdue,
  type OnboardingItem,
} from '@wcrm/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recordAudit } from '../../audit/record';
import type { Db } from '../../db/client';
import {
  onboardingChecklists,
  onboardingItems,
  onboardingKits,
  users,
} from '../../db/schema/index';
import { AppError, notFound } from '../../lib/errors';
import { actorOf, authOf, hasRole, ok } from '../../lib/http';
import { parse } from '../../lib/validate';
import type { RulesContext } from '../../services/rulesContext';

export async function listOnboarding(db: Db, ctx: RulesContext, today: string) {
  const rows = await db
    .select({ c: onboardingChecklists, fullName: users.fullName, email: users.email })
    .from(onboardingChecklists)
    .innerJoin(users, eq(users.id, onboardingChecklists.userId))
    .orderBy(onboardingChecklists.startDate);
  const items = await db.select().from(onboardingItems);
  const firsts = await db.execute<{ user_id: string; first: string }>(sql`
    SELECT u AS user_id, min(created_at)::date::text AS first FROM (
      SELECT owner_id AS u, created_at FROM opportunities UNION ALL SELECT created_by, created_at FROM opportunities WHERE created_by IS NOT NULL
    ) x GROUP BY u`);
  return rows.map((r) => {
    const mine = items.filter((i) => i.checklistId === r.c.id);
    const first = firsts.rows.find((f) => f.user_id === r.c.userId)?.first ?? null;
    const firstAfterStart = first && first >= r.c.startDate ? first : null;
    const pending = mine.filter((i) => !i.doneAt).length;
    return {
      ...r.c,
      fullName: r.fullName,
      email: r.email,
      items: mine,
      done: mine.length - pending,
      total: mine.length,
      firstOpportunityOn: firstAfterStart,
      daysToFirstOpportunity: daysToFirstOpportunity(r.c.startDate, firstAfterStart),
      overdue: onboardingOverdue(
        { startDate: r.c.startDate, pendingItems: pending, productiveAt: r.c.productiveAt },
        today,
        ctx.settings,
      ),
    };
  });
}

/** P15: per-country onboarding kit, per-person checklist, time to first opportunity. */
export async function onboardingRoutes(app: FastifyInstance) {
  const { db, rules } = app.ctx;

  app.get('/onboarding/kits', { config: { guard: { process: 'P15', action: 'view' } } }, async () =>
    ok(await db.select().from(onboardingKits)),
  );

  app.put(
    '/onboarding/kits/:country',
    { config: { guard: { process: 'P15', action: 'write' } } },
    async (req) => {
      const { country } = parse(z.object({ country: z.string().length(2) }), req.params);
      const body = parse(OnboardingKitSchema, req.body);
      const values = {
        countryCode: country,
        items: body.items,
        productiveDays: body.productiveDays,
        notes: body.notes ?? null,
      };
      const [k] = await db
        .insert(onboardingKits)
        .values(values)
        .onConflictDoUpdate({
          target: onboardingKits.countryCode,
          set: { ...values, updatedAt: new Date() },
        })
        .returning();
      await recordAudit(db, actorOf(req), {
        action: 'SETTING_CHANGE',
        category: 'CONFIG',
        entityType: 'onboarding_kit',
        entityId: country,
        changes: [{ field: 'items', old: null, new: body.items }],
      });
      return ok(k);
    },
  );

  app.get('/onboarding', { config: { guard: { process: 'P15', action: 'view' } } }, async (req) =>
    ok(await listOnboarding(db, await rules.get(), req.today)),
  );

  app.post(
    '/onboarding',
    { config: { guard: { process: 'P15', action: 'write' } } },
    async (req, reply) => {
      const body = parse(OnboardingCreateSchema, req.body);
      const ctx = await rules.get();
      const [kit] = await db
        .select()
        .from(onboardingKits)
        .where(eq(onboardingKits.countryCode, body.countryCode));
      const itemsList: OnboardingItem[] = kit?.items ?? [...ONBOARDING_ITEMS];
      const days = kit?.productiveDays ?? ctx.settings['onboarding.productiveDays'];
      const row = await db.transaction(async (tx) => {
        const [c] = await tx
          .insert(onboardingChecklists)
          .values({
            ...body,
            productiveTargetOn: addDays(body.startDate, days),
            createdBy: authOf(req).user.id,
          })
          .returning();
        await tx
          .insert(onboardingItems)
          .values(itemsList.map((item) => ({ checklistId: c!.id, item })));
        await tx.update(users).set({ joinedOn: body.startDate }).where(eq(users.id, body.userId));
        await recordAudit(tx, actorOf(req), {
          action: 'CREATE',
          category: 'DATA',
          entityType: 'onboarding_checklist',
          entityId: c!.id,
        });
        return c;
      });
      return reply.status(201).send(ok(row));
    },
  );

  /** Item done by the person themself or by P15 R/A. */
  app.patch('/onboarding/:id/items/:item', { config: { session: true } }, async (req) => {
    const p = parse(
      z.object({ id: z.string().uuid(), item: z.enum(ONBOARDING_ITEMS) }),
      req.params,
    );
    const body = parse(OnboardingItemSchema, req.body);
    const auth = authOf(req);
    const [c] = await db
      .select()
      .from(onboardingChecklists)
      .where(eq(onboardingChecklists.id, p.id));
    if (!c) throw notFound();
    if (c.userId !== auth.user.id && !hasRole(req, 'COUNTRY_MANAGER', 'ADMIN'))
      throw new AppError(403, 'FORBIDDEN');
    await db
      .update(onboardingItems)
      .set({
        doneAt: body.done ? new Date() : null,
        doneBy: body.done ? auth.user.id : null,
        notes: body.notes ?? null,
      })
      .where(and(eq(onboardingItems.checklistId, p.id), eq(onboardingItems.item, p.item)));
    const pending = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(onboardingItems)
      .where(and(eq(onboardingItems.checklistId, p.id), sql`${onboardingItems.doneAt} IS NULL`));
    await db
      .update(onboardingChecklists)
      .set({ productiveAt: pending[0]!.n === 0 ? req.today : null })
      .where(eq(onboardingChecklists.id, p.id));
    return ok({ pending: pending[0]!.n });
  });
}
