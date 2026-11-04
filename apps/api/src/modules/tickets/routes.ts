import { daysBetween, TicketCreateSchema, TicketUpdateSchema } from '@wcrm/shared';
import { asc, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { diffFields, recordAudit } from '../../audit/record';
import { accounts, tickets } from '../../db/schema/index';
import { notFound } from '../../lib/errors';
import { actorOf, authOf, ok } from '../../lib/http';
import { parse } from '../../lib/validate';

const FIELDS = [
  'title',
  'priority',
  'status',
  'ballIn',
  'orgHolder',
  'ownerName',
  'slaDueOn',
  'notes',
];
const OPEN = ['OPEN', 'IN_PROGRESS', 'PENDING_CLIENT'];

/** eDo-like tickets per account (legacy "Incidentes eDo", P10-02). */
export async function ticketRoutes(app: FastifyInstance) {
  const { db } = app.ctx;
  const idParam = z.object({ id: z.string().uuid() });

  app.get('/tickets', { config: { guard: { process: 'P10', action: 'view' } } }, async (req) => {
    const rows = await db
      .select({ t: tickets, accountName: accounts.name })
      .from(tickets)
      .innerJoin(accounts, eq(accounts.id, tickets.accountId))
      .orderBy(asc(tickets.status), asc(tickets.priority), desc(tickets.lastUpdateAt));
    return ok(
      rows.map((r) => {
        const open = OPEN.includes(r.t.status);
        const lastUpdate = r.t.lastUpdateAt.toISOString().slice(0, 10);
        return {
          ...r.t,
          accountName: r.accountName,
          isOpen: open,
          agingDays: daysBetween(r.t.openedOn, r.t.closedOn ?? req.today),
          daysSinceUpdate: daysBetween(lastUpdate, req.today),
          slaOverdue: open && r.t.slaDueOn !== null && r.t.slaDueOn < req.today,
          // "A quién presionar hoy": open, idle ≥ 3 days
          pushToday: open && daysBetween(lastUpdate, req.today) >= 3,
        };
      }),
    );
  });

  app.post(
    '/tickets',
    { config: { guard: { process: 'P10', action: 'write' } } },
    async (req, reply) => {
      const body = parse(TicketCreateSchema, req.body);
      const row = await db.transaction(async (tx) => {
        const [t] = await tx
          .insert(tickets)
          .values({ ...body, createdBy: authOf(req).user.id })
          .returning();
        await recordAudit(tx, actorOf(req), {
          action: 'CREATE',
          category: 'DATA',
          entityType: 'ticket',
          entityId: t!.id,
          accountId: t!.accountId,
          changes: diffFields(null, t!, FIELDS),
        });
        return t!;
      });
      return reply.status(201).send(ok(row));
    },
  );

  app.patch(
    '/tickets/:id',
    { config: { guard: { process: 'P10', action: 'write' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const body = parse(TicketUpdateSchema, req.body);
      return ok(
        await db.transaction(async (tx) => {
          const [before] = await tx.select().from(tickets).where(eq(tickets.id, id)).for('update');
          if (!before) throw notFound();
          const closing =
            body.status && !OPEN.includes(body.status) && OPEN.includes(before.status);
          const [after] = await tx
            .update(tickets)
            .set({
              ...body,
              closedOn: closing
                ? req.today
                : body.status && OPEN.includes(body.status)
                  ? null
                  : before.closedOn,
              lastUpdateAt: sql`now()`,
              updatedAt: new Date(),
              rowVersion: before.rowVersion + 1,
            })
            .where(eq(tickets.id, id))
            .returning();
          await recordAudit(tx, actorOf(req), {
            action: 'UPDATE',
            category: 'DATA',
            entityType: 'ticket',
            entityId: id,
            accountId: before.accountId,
            changes: diffFields(before, after!, FIELDS),
          });
          return after;
        }),
      );
    },
  );
}
