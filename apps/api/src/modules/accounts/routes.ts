import {
  AccountCreateSchema,
  AccountUpdateSchema,
  ActivityCreateSchema,
  ContactCreateSchema,
  ContactUpdateSchema,
} from '@wcrm/shared';
import { and, asc, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { diffFields, recordAudit } from '../../audit/record';
import { accounts, activities, contacts, opportunities } from '../../db/schema/index';
import { AppError, conflict, notFound } from '../../lib/errors';
import { actorOf, authOf, ok } from '../../lib/http';
import { parse } from '../../lib/validate';

const ACCOUNT_FIELDS = [
  'name',
  'legalName',
  'taxId',
  'countryCode',
  'vertical',
  'customerType',
  'defaultBillingEntityId',
  'currency',
  'isKeyAccount',
  'acceptsSimpleEsign',
  'ownerId',
] as const;
const CONTACT_FIELDS = [
  'firstName',
  'lastName',
  'jobTitle',
  'email',
  'phone',
  'buyingRoles',
] as const;

const ListQuery = z.object({
  q: z.string().optional(),
  countryCode: z.string().length(2).optional(),
  vertical: z.string().optional(),
  customerType: z.string().optional(),
});

export async function accountRoutes(app: FastifyInstance) {
  const { db } = app.ctx;
  const idParam = z.object({ id: z.string().uuid() });

  app.get('/accounts', { config: { guard: { process: 'P1', action: 'view' } } }, async (req) => {
    const q = parse(ListQuery, req.query);
    const where: SQL[] = [sql`${accounts.archivedAt} IS NULL`];
    if (q.q) where.push(or(ilike(accounts.name, `%${q.q}%`), ilike(accounts.taxId, `%${q.q}%`))!);
    if (q.countryCode) where.push(eq(accounts.countryCode, q.countryCode));
    if (q.vertical) where.push(sql`${accounts.vertical}::text = ${q.vertical}`);
    if (q.customerType) where.push(sql`${accounts.customerType}::text = ${q.customerType}`);
    const rows = await db
      .select({
        account: accounts,
        openOpportunities: sql<number>`(select count(*)::int from ${opportunities} o where o.account_id = ${accounts.id} and o.status = 'OPEN')`,
        openPipelineUsd: sql<string>`(select coalesce(sum(o.amount_usd),0)::text from ${opportunities} o where o.account_id = ${accounts.id} and o.status = 'OPEN' and o.stage < 7)`,
        contactsCount: sql<number>`(select count(*)::int from ${contacts} c where c.account_id = ${accounts.id} and c.archived_at is null)`,
      })
      .from(accounts)
      .where(and(...where))
      .orderBy(asc(accounts.name));
    return ok(rows.map((r) => ({ ...r.account, ...r, account: undefined })));
  });

  app.post(
    '/accounts',
    { config: { guard: { process: 'P1', action: 'write' } } },
    async (req, reply) => {
      const body = parse(AccountCreateSchema, req.body);
      const confirm = (req.query as Record<string, string>).confirmDuplicate === 'true';
      // CORE-01: possible duplicate by name or tax id
      const dup = await db
        .select({ id: accounts.id, name: accounts.name })
        .from(accounts)
        .where(
          or(
            sql`lower(${accounts.name}) = lower(${body.name})`,
            body.taxId
              ? and(eq(accounts.taxId, body.taxId), eq(accounts.countryCode, body.countryCode))
              : sql`false`,
          ),
        )
        .limit(1);
      if (dup[0] && !confirm) {
        throw conflict('DUPLICATE', [
          {
            code: 'ACCOUNT_POSSIBLE_DUPLICATE',
            params: { existingId: dup[0].id, name: dup[0].name },
          },
        ]);
      }
      const auth = authOf(req);
      const row = await db.transaction(async (tx) => {
        const [a] = await tx
          .insert(accounts)
          .values({
            ...body,
            ownerId: body.ownerId ?? auth.user.id,
            createdBy: auth.user.id,
            updatedBy: auth.user.id,
          })
          .returning();
        await recordAudit(tx, actorOf(req), {
          action: 'CREATE',
          category: 'DATA',
          entityType: 'account',
          entityId: a!.id,
          accountId: a!.id,
          changes: diffFields(null, a!, ACCOUNT_FIELDS),
        });
        return a!;
      });
      return reply.status(201).send(ok(row));
    },
  );

  app.get(
    '/accounts/:id',
    { config: { guard: { process: 'P1', action: 'view' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const [a] = await db.select().from(accounts).where(eq(accounts.id, id));
      if (!a) throw notFound();
      const cs = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.accountId, id), sql`${contacts.archivedAt} IS NULL`))
        .orderBy(asc(contacts.lastName));
      const opps = await db
        .select({
          id: opportunities.id,
          code: opportunities.code,
          name: opportunities.name,
          stage: opportunities.stage,
          status: opportunities.status,
          amountUsd: opportunities.amountUsd,
        })
        .from(opportunities)
        .where(eq(opportunities.accountId, id))
        .orderBy(desc(opportunities.createdAt));
      return ok({ ...a, contacts: cs, opportunities: opps });
    },
  );

  app.patch(
    '/accounts/:id',
    { config: { guard: { process: 'P1', action: 'write' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const body = parse(AccountUpdateSchema, req.body);
      const { rowVersion, ...patch } = body;
      const auth = authOf(req);
      return ok(
        await db.transaction(async (tx) => {
          const [before] = await tx
            .select()
            .from(accounts)
            .where(eq(accounts.id, id))
            .for('update');
          if (!before) throw notFound();
          if (before.rowVersion !== rowVersion) throw conflict();
          const [after] = await tx
            .update(accounts)
            .set({
              ...patch,
              rowVersion: rowVersion + 1,
              updatedAt: new Date(),
              updatedBy: auth.user.id,
            })
            .where(eq(accounts.id, id))
            .returning();
          await recordAudit(tx, actorOf(req), {
            action: 'UPDATE',
            category: 'DATA',
            entityType: 'account',
            entityId: id,
            accountId: id,
            changes: diffFields(before, after!, ACCOUNT_FIELDS),
          });
          return after;
        }),
      );
    },
  );

  app.get(
    '/accounts/:id/contacts',
    { config: { guard: { process: 'P1', action: 'view' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      return ok(
        await db
          .select()
          .from(contacts)
          .where(and(eq(contacts.accountId, id), sql`${contacts.archivedAt} IS NULL`))
          .orderBy(asc(contacts.lastName)),
      );
    },
  );

  app.post(
    '/accounts/:id/contacts',
    { config: { guard: { process: 'P1', action: 'write' } } },
    async (req, reply) => {
      const { id } = parse(idParam, req.params);
      const body = parse(ContactCreateSchema, req.body);
      const [acc] = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, id));
      if (!acc) throw notFound();
      const auth = authOf(req);
      const row = await db.transaction(async (tx) => {
        const [c] = await tx
          .insert(contacts)
          .values({ ...body, email: body.email || null, accountId: id, createdBy: auth.user.id })
          .returning();
        await recordAudit(tx, actorOf(req), {
          action: 'CREATE',
          category: 'DATA',
          entityType: 'contact',
          entityId: c!.id,
          accountId: id,
          changes: diffFields(null, c!, CONTACT_FIELDS, { pii: true }),
        });
        return c!;
      });
      return reply.status(201).send(ok(row));
    },
  );

  app.patch(
    '/contacts/:id',
    { config: { guard: { process: 'P1', action: 'write' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const body = parse(ContactUpdateSchema, req.body);
      return ok(
        await db.transaction(async (tx) => {
          const [before] = await tx
            .select()
            .from(contacts)
            .where(eq(contacts.id, id))
            .for('update');
          if (!before) throw notFound();
          const [after] = await tx
            .update(contacts)
            .set({
              ...body,
              email: body.email === '' ? null : body.email,
              updatedAt: new Date(),
              rowVersion: before.rowVersion + 1,
            })
            .where(eq(contacts.id, id))
            .returning();
          await recordAudit(tx, actorOf(req), {
            action: 'UPDATE',
            category: 'DATA',
            entityType: 'contact',
            entityId: id,
            accountId: before.accountId,
            changes: diffFields(before, after!, CONTACT_FIELDS, { pii: true }),
          });
          return after;
        }),
      );
    },
  );

  app.get('/activities', { config: { guard: { process: 'P1', action: 'view' } } }, async (req) => {
    const q = parse(
      z.object({
        accountId: z.string().uuid().optional(),
        opportunityId: z.string().uuid().optional(),
      }),
      req.query,
    );
    if (!q.accountId && !q.opportunityId) throw new AppError(400, 'VALIDATION_ERROR');
    const where = q.opportunityId
      ? eq(activities.opportunityId, q.opportunityId)
      : eq(activities.accountId, q.accountId!);
    return ok(
      await db
        .select()
        .from(activities)
        .where(where)
        .orderBy(desc(activities.occurredAt))
        .limit(200),
    );
  });

  app.post(
    '/activities',
    { config: { guard: { process: 'P1', action: 'write' } } },
    async (req, reply) => {
      const body = parse(ActivityCreateSchema, req.body);
      const auth = authOf(req);
      const occurredAt = new Date(
        body.occurredAt.length === 10 ? `${body.occurredAt}T12:00:00Z` : body.occurredAt,
      );
      const row = await db.transaction(async (tx) => {
        const [a] = await tx
          .insert(activities)
          .values({ ...body, occurredAt, userIds: [auth.user.id], createdBy: auth.user.id })
          .returning();
        if (body.opportunityId) {
          await tx
            .update(opportunities)
            .set({
              lastActivityAt: sql`greatest(coalesce(${opportunities.lastActivityAt}, ${occurredAt}), ${occurredAt})`,
            })
            .where(eq(opportunities.id, body.opportunityId));
        }
        return a!;
      });
      return reply.status(201).send(ok(row));
    },
  );
}
