import { FxRateCreateSchema } from '@wcrm/shared';
import { asc, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { recordAudit } from '../../audit/record';
import { billingEntities, countries, fxRates, userRoles, users } from '../../db/schema/index';
import { actorOf, ok } from '../../lib/http';
import { parse } from '../../lib/validate';

export async function catalogRoutes(app: FastifyInstance) {
  const { db, rules } = app.ctx;

  app.get('/catalogs', { config: { session: true } }, async () => {
    const [cs, bes, us] = await Promise.all([
      db.select().from(countries).orderBy(asc(countries.code)),
      db.select().from(billingEntities).where(eq(billingEntities.active, true)),
      db
        .select({
          id: users.id,
          fullName: users.fullName,
          email: users.email,
          roles: sql<
            string[]
          >`coalesce(array_agg(${userRoles.role}) filter (where ${userRoles.role} is not null), '{}')`,
        })
        .from(users)
        .leftJoin(userRoles, eq(userRoles.userId, users.id))
        .where(eq(users.isActive, true))
        .groupBy(users.id)
        .orderBy(asc(users.fullName)),
    ]);
    return ok({ countries: cs, billingEntities: bes, users: us });
  });

  /** Parameters the SPA needs to pre-validate rules (API.md §3). */
  app.get('/settings/public', { config: { session: true } }, async () => {
    const r = await rules.get();
    return ok({ settings: r.settings, raciVersion: r.raciVersion });
  });

  app.get('/fx-rates', { config: { session: true } }, async () =>
    ok(await db.select().from(fxRates).orderBy(desc(fxRates.month), asc(fxRates.currency))),
  );

  app.post(
    '/fx-rates',
    { config: { guard: { process: 'P8', action: 'view', actionRole: 'FX.write' } } },
    async (req, reply) => {
      const body = parse(FxRateCreateSchema, req.body);
      const [row] = await db
        .insert(fxRates)
        .values({ ...body, loadedBy: req.auth!.user.id })
        .onConflictDoUpdate({
          target: [fxRates.month, fxRates.currency, fxRates.kind],
          set: { unitsPerUsd: body.unitsPerUsd, source: body.source, loadedAt: new Date() },
        })
        .returning();
      await recordAudit(db, actorOf(req), {
        action: 'FX_CHANGE',
        category: 'CONFIG',
        entityType: 'fx_rate',
        entityId: `${body.month}:${body.currency}:${body.kind}`,
        changes: [{ field: 'unitsPerUsd', old: null, new: body.unitsPerUsd }],
      });
      rules.invalidate();
      return reply.status(201).send(ok(row));
    },
  );
}
