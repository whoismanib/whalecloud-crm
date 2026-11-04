import {
  DEFAULT_SETTINGS,
  HolidaySchema,
  RaciUpdateSchema,
  SettingsSchema,
  SettingUpdateSchema,
  UserCreateSchema,
  UserUpdateSchema,
  type SettingKey,
} from '@wcrm/shared';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recordAudit } from '../../audit/record';
import { hashPassword } from '../../auth/crypto';
import {
  calendars,
  holidays,
  raciEntries,
  raciVersions,
  sessions,
  settings,
  settingsHistory,
  userRoles,
  users,
} from '../../db/schema/index';
import { AppError, notFound, ruleViolation } from '../../lib/errors';
import { actorOf, authOf, ok } from '../../lib/http';
import { parse } from '../../lib/validate';
import { JOBS, runJob } from '../../jobs/index';

/** ADM: users/roles, versioned RACI, settings with history, holiday calendars, manual job runs. */
export async function adminRoutes(app: FastifyInstance) {
  const { db, rules, config } = app.ctx;
  const idParam = z.object({ id: z.string().uuid() });

  app.get('/admin/users', { config: { guard: { process: 'ADM', action: 'view' } } }, async () => {
    const rows = await db
      .select({
        id: users.id,
        email: users.email,
        fullName: users.fullName,
        locale: users.locale,
        timezone: users.timezone,
        calendarId: users.calendarId,
        countryCodes: users.countryCodes,
        isActive: users.isActive,
        mfaEnabled: users.mfaEnabled,
        lastLoginAt: users.lastLoginAt,
        roles: sql<
          string[]
        >`coalesce(array_agg(${userRoles.role}) filter (where ${userRoles.role} is not null), '{}')::text[]`,
      })
      .from(users)
      .leftJoin(userRoles, eq(userRoles.userId, users.id))
      .groupBy(users.id)
      .orderBy(asc(users.fullName));
    return ok(rows);
  });

  app.post(
    '/admin/users',
    { config: { guard: { process: 'ADM', action: 'write' } } },
    async (req, reply) => {
      const body = parse(UserCreateSchema, req.body);
      const row = await db.transaction(async (tx) => {
        const [u] = await tx
          .insert(users)
          .values({
            email: body.email,
            fullName: body.fullName,
            passwordHash: await hashPassword(body.password, {
              memoryCost: config.ARGON2_MEMORY_KIB,
              timeCost: config.ARGON2_TIME_COST,
            }),
            locale: body.locale,
            timezone: body.timezone,
            calendarId: body.calendarId,
            countryCodes: body.countryCodes,
            createdBy: authOf(req).user.id,
          })
          .returning({ id: users.id, email: users.email });
        await tx
          .insert(userRoles)
          .values(
            body.roles.map((role) => ({ userId: u!.id, role, grantedBy: authOf(req).user.id })),
          );
        await recordAudit(tx, actorOf(req), {
          action: 'CREATE',
          category: 'SECURITY',
          entityType: 'user',
          entityId: u!.id,
          changes: [{ field: 'roles', old: null, new: body.roles }],
        });
        return u;
      });
      return reply.status(201).send(ok(row));
    },
  );

  app.patch(
    '/admin/users/:id',
    { config: { guard: { process: 'ADM', action: 'write' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const body = parse(UserUpdateSchema, req.body);
      if (id === authOf(req).user.id && body.isActive === false)
        throw ruleViolation([{ code: 'CANNOT_DEACTIVATE_SELF' }]);
      return ok(
        await db.transaction(async (tx) => {
          const [before] = await tx.select().from(users).where(eq(users.id, id));
          if (!before) throw notFound();
          const oldRoles = (
            await tx
              .select({ role: userRoles.role })
              .from(userRoles)
              .where(eq(userRoles.userId, id))
          ).map((r) => r.role);
          const { roles, password, ...rest } = body;
          const patch: Record<string, unknown> = { ...rest, updatedAt: new Date() };
          if (password)
            patch.passwordHash = await hashPassword(password, {
              memoryCost: config.ARGON2_MEMORY_KIB,
              timeCost: config.ARGON2_TIME_COST,
            });
          if (body.isActive === false) patch.deactivatedAt = new Date();
          await tx.update(users).set(patch).where(eq(users.id, id));
          if (roles) {
            await tx.delete(userRoles).where(eq(userRoles.userId, id));
            await tx
              .insert(userRoles)
              .values(roles.map((role) => ({ userId: id, role, grantedBy: authOf(req).user.id })));
          }
          // ADM-12: deactivation / role change revokes sessions immediately
          if (body.isActive === false || roles || password)
            await tx.delete(sessions).where(eq(sessions.userId, id));
          await recordAudit(tx, actorOf(req), {
            action: password ? 'PASSWORD_CHANGE' : 'UPDATE',
            category: 'SECURITY',
            entityType: 'user',
            entityId: id,
            changes: [
              ...(roles ? [{ field: 'roles', old: oldRoles, new: roles }] : []),
              ...(body.isActive !== undefined
                ? [{ field: 'isActive', old: before.isActive, new: body.isActive }]
                : []),
              ...(body.countryCodes
                ? [{ field: 'countryCodes', old: before.countryCodes, new: body.countryCodes }]
                : []),
            ],
          });
          return { id };
        }),
      );
    },
  );

  // ---------- RACI (ADM-03) ----------
  app.get('/admin/raci', { config: { guard: { process: 'ADM', action: 'view' } } }, async () => {
    const versions = await db.select().from(raciVersions).orderBy(desc(raciVersions.version));
    const active = versions.find((v) => v.isActive);
    const entries = active
      ? await db.select().from(raciEntries).where(eq(raciEntries.raciVersionId, active.id))
      : [];
    return ok({ active, versions, entries });
  });

  app.put(
    '/admin/raci',
    { config: { guard: { process: 'ADM', action: 'approve' } } },
    async (req) => {
      const body = parse(RaciUpdateSchema, req.body);
      // ADMIN must keep R/A on ADM to avoid locking everyone out
      const adm = body.entries.find((e) => e.process === 'ADM' && e.role === 'ADMIN');
      if (adm && !adm.letters.some((l) => l === 'R' || l === 'A'))
        throw ruleViolation([{ code: 'RACI_ADMIN_LOCKOUT' }]);
      const v = await db.transaction(async (tx) => {
        const [{ max } = { max: 0 }] = await tx
          .select({ max: sql<number>`coalesce(max(${raciVersions.version}),0)::int` })
          .from(raciVersions);
        const [prev] = await tx.select().from(raciVersions).where(eq(raciVersions.isActive, true));
        const prevEntries = prev
          ? await tx.select().from(raciEntries).where(eq(raciEntries.raciVersionId, prev.id))
          : [];
        await tx
          .update(raciVersions)
          .set({ isActive: false })
          .where(eq(raciVersions.isActive, true));
        const [nv] = await tx
          .insert(raciVersions)
          .values({
            version: max + 1,
            isActive: true,
            createdBy: authOf(req).user.id,
            comment: body.comment,
          })
          .returning();
        // start from the previous matrix, apply the submitted cells
        const merged = new Map(prevEntries.map((e) => [`${e.process}:${e.role}`, e.letters]));
        for (const e of body.entries) merged.set(`${e.process}:${e.role}`, e.letters);
        await tx.insert(raciEntries).values(
          [...merged.entries()].map(([k, letters]) => {
            const [process, role] = k.split(':') as [never, never];
            return { raciVersionId: nv!.id, process, role, letters };
          }),
        );
        await recordAudit(tx, actorOf(req), {
          action: 'RACI_CHANGE',
          category: 'CONFIG',
          entityType: 'raci_version',
          entityId: String(nv!.version),
          changes: body.entries.map((e) => ({
            field: `${e.process}.${e.role}`,
            old:
              prevEntries.find((p) => p.process === e.process && p.role === e.role)?.letters ?? [],
            new: e.letters,
          })),
          reason: body.comment,
        });
        return nv!;
      });
      rules.invalidate();
      return ok(v);
    },
  );

  // ---------- settings (ADM-07) ----------
  app.get(
    '/admin/settings',
    { config: { guard: { process: 'ADM', action: 'view' } } },
    async () => {
      const r = await rules.get();
      return ok(
        Object.keys(DEFAULT_SETTINGS).map((key) => ({ key, value: r.settings[key as SettingKey] })),
      );
    },
  );

  app.put(
    '/admin/settings/:key',
    { config: { guard: { process: 'ADM', action: 'approve' } } },
    async (req) => {
      const { key } = parse(z.object({ key: z.string() }), req.params);
      const body = parse(SettingUpdateSchema, req.body);
      const shape = SettingsSchema.shape as Record<string, z.ZodTypeAny>;
      if (!shape[key]) throw new AppError(404, 'NOT_FOUND');
      const value = parse(shape[key]!, body.value);
      const old = (await rules.get()).settings[key as SettingKey];
      await db.transaction(async (tx) => {
        await tx
          .insert(settings)
          .values({ key, value, updatedBy: authOf(req).user.id })
          .onConflictDoUpdate({
            target: settings.key,
            set: { value, updatedAt: new Date(), updatedBy: authOf(req).user.id },
          });
        await tx.insert(settingsHistory).values({ key, value, changedBy: authOf(req).user.id });
        await recordAudit(tx, actorOf(req), {
          action: 'SETTING_CHANGE',
          category: 'CONFIG',
          entityType: 'setting',
          entityId: key,
          changes: [{ field: key, old, new: value }],
          reason: body.reason,
        });
      });
      rules.invalidate();
      return ok({ key, value });
    },
  );

  app.get(
    '/admin/settings/:key/history',
    { config: { guard: { process: 'ADM', action: 'view' } } },
    async (req) => {
      const { key } = parse(z.object({ key: z.string() }), req.params);
      return ok(
        await db
          .select()
          .from(settingsHistory)
          .where(eq(settingsHistory.key, key))
          .orderBy(desc(settingsHistory.id)),
      );
    },
  );

  // ---------- calendars (ADM-08) ----------
  app.get('/admin/calendars', { config: { session: true } }, async () => {
    const cals = await db.select().from(calendars);
    const hs = await db.select().from(holidays).orderBy(asc(holidays.date));
    return ok(cals.map((c) => ({ ...c, holidays: hs.filter((h) => h.calendarId === c.id) })));
  });

  app.post(
    '/admin/calendars/:id/holidays',
    { config: { guard: { process: 'ADM', action: 'write' } } },
    async (req, reply) => {
      const { id } = parse(z.object({ id: z.string() }), req.params);
      const body = parse(HolidaySchema, req.body);
      const [h] = await db
        .insert(holidays)
        .values({ calendarId: id, ...body })
        .onConflictDoUpdate({
          target: [holidays.calendarId, holidays.date],
          set: { name: body.name, isWorkday: body.isWorkday },
        })
        .returning();
      await recordAudit(db, actorOf(req), {
        action: 'SETTING_CHANGE',
        category: 'CONFIG',
        entityType: 'holiday',
        entityId: `${id}:${body.date}`,
        changes: [{ field: 'holiday', old: null, new: body.name }],
      });
      rules.invalidate();
      return reply.status(201).send(ok(h));
    },
  );

  app.delete(
    '/admin/calendars/:id/holidays/:date',
    { config: { guard: { process: 'ADM', action: 'write' } } },
    async (req) => {
      const p = parse(z.object({ id: z.string(), date: z.string() }), req.params);
      await db
        .delete(holidays)
        .where(and(eq(holidays.calendarId, p.id), eq(holidays.date, p.date)));
      await recordAudit(db, actorOf(req), {
        action: 'SETTING_CHANGE',
        category: 'CONFIG',
        entityType: 'holiday',
        entityId: `${p.id}:${p.date}`,
        changes: [{ field: 'holiday', old: p.date, new: null }],
      });
      rules.invalidate();
      return ok({ deleted: true });
    },
  );

  // ---------- jobs (worker logic on demand) ----------
  app.get('/admin/jobs', { config: { guard: { process: 'ADM', action: 'view' } } }, async () =>
    ok(
      Object.entries(JOBS).map(([name, j]) => ({ name, cron: j.cron, description: j.description })),
    ),
  );

  app.post(
    '/admin/jobs/:name/run',
    { config: { guard: { process: 'ADM', action: 'approve' } } },
    async (req) => {
      const { name } = parse(z.object({ name: z.string() }), req.params);
      if (!(name in JOBS)) throw new AppError(404, 'NOT_FOUND');
      return ok(await runJob(name as keyof typeof JOBS, app.ctx, req.today));
    },
  );
}
