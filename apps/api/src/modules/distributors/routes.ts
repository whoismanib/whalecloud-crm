import {
  agreementFailures,
  AgreementSchema,
  DealRegistrationSchema,
  detectChannelConflict,
  DistributorSchema,
  RegistrationDecisionSchema,
  TrainingSchema,
} from '@wcrm/shared';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { diffFields, recordAudit } from '../../audit/record';
import type { DbOrTx } from '../../db/client';
import {
  accounts,
  dealRegistrations,
  distributorAgreements,
  distributors,
  distributorTrainings,
  opportunities,
} from '../../db/schema/index';
import { notFound, ruleViolation } from '../../lib/errors';
import { actorOf, authOf, ok } from '../../lib/http';
import { parse } from '../../lib/validate';
import { notify } from '../../services/notify';

/** Agreement check reused by opportunity creation with origin DISTRIBUTOR (P13-01). */
export async function distributorAgreementFailures(
  db: DbOrTx,
  distributorId: string,
  opts: { today: string; country: string; vertical?: string | null },
) {
  const ags = await db
    .select()
    .from(distributorAgreements)
    .where(eq(distributorAgreements.distributorId, distributorId));
  return agreementFailures(ags, opts);
}

export async function distributorRoutes(app: FastifyInstance) {
  const { db, rules, mailer } = app.ctx;
  const idParam = z.object({ id: z.string().uuid() });

  app.get(
    '/distributors',
    { config: { guard: { process: 'P13', action: 'view' } } },
    async (req) => {
      const ds = await db
        .select()
        .from(distributors)
        .where(sql`${distributors.archivedAt} IS NULL`)
        .orderBy(distributors.name);
      const ags = await db.select().from(distributorAgreements);
      const pipe = await db
        .select({
          distributorId: opportunities.distributorId,
          open: sql<string>`coalesce(sum(${opportunities.amountUsd}) filter (where ${opportunities.status}='OPEN' and ${opportunities.stage} < 7),0)::text`,
          won: sql<string>`coalesce(sum(${opportunities.amountUsd}) filter (where ${opportunities.stage} >= 7),0)::text`,
        })
        .from(opportunities)
        .where(sql`${opportunities.distributorId} IS NOT NULL`)
        .groupBy(opportunities.distributorId);
      return ok(
        ds.map((d) => {
          const mine = ags.filter((a) => a.distributorId === d.id);
          return {
            ...d,
            agreementOk:
              agreementFailures(mine, { today: req.today, country: d.countryCode }).length === 0,
            agreementEndsOn:
              mine
                .map((a) => a.endsOn)
                .sort()
                .at(-1) ?? null,
            pipelineUsd: pipe.find((p) => p.distributorId === d.id)?.open ?? '0',
            wonUsd: pipe.find((p) => p.distributorId === d.id)?.won ?? '0',
          };
        }),
      );
    },
  );

  app.post(
    '/distributors',
    { config: { guard: { process: 'P13', action: 'write' } } },
    async (req, reply) => {
      const body = parse(DistributorSchema, req.body);
      const row = await db.transaction(async (tx) => {
        const [d] = await tx
          .insert(distributors)
          .values({
            ...body,
            contactEmail: body.contactEmail || null,
            createdBy: authOf(req).user.id,
          })
          .returning();
        await recordAudit(tx, actorOf(req), {
          action: 'CREATE',
          category: 'DATA',
          entityType: 'distributor',
          entityId: d!.id,
        });
        return d;
      });
      return reply.status(201).send(ok(row));
    },
  );

  app.patch(
    '/distributors/:id',
    { config: { guard: { process: 'P13', action: 'write' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const body = parse(DistributorSchema.partial(), req.body);
      return ok(
        await db.transaction(async (tx) => {
          const [before] = await tx.select().from(distributors).where(eq(distributors.id, id));
          if (!before) throw notFound();
          const [after] = await tx
            .update(distributors)
            .set({
              ...body,
              contactEmail: body.contactEmail === '' ? null : body.contactEmail,
              updatedAt: new Date(),
            })
            .where(eq(distributors.id, id))
            .returning();
          await recordAudit(tx, actorOf(req), {
            action: 'UPDATE',
            category: 'DATA',
            entityType: 'distributor',
            entityId: id,
            changes: diffFields(before, after!, Object.keys(body)),
          });
          return after;
        }),
      );
    },
  );

  app.get(
    '/distributors/:id',
    { config: { guard: { process: 'P13', action: 'view' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const [d] = await db.select().from(distributors).where(eq(distributors.id, id));
      if (!d) throw notFound();
      const [agreements, registrations, trainings] = await Promise.all([
        db
          .select()
          .from(distributorAgreements)
          .where(eq(distributorAgreements.distributorId, id))
          .orderBy(desc(distributorAgreements.startsOn)),
        db
          .select({ r: dealRegistrations, accountName: accounts.name })
          .from(dealRegistrations)
          .innerJoin(accounts, eq(accounts.id, dealRegistrations.accountId))
          .where(eq(dealRegistrations.distributorId, id))
          .orderBy(desc(dealRegistrations.registeredOn)),
        db
          .select()
          .from(distributorTrainings)
          .where(eq(distributorTrainings.distributorId, id))
          .orderBy(desc(distributorTrainings.heldOn)),
      ]);
      return ok({
        ...d,
        agreements,
        registrations: registrations.map((r) => ({ ...r.r, accountName: r.accountName })),
        trainings,
      });
    },
  );

  app.post(
    '/distributors/:id/agreements',
    { config: { guard: { process: 'P13', action: 'approve' } } },
    async (req, reply) => {
      const { id } = parse(idParam, req.params);
      const body = parse(AgreementSchema, req.body);
      if (body.endsOn < body.startsOn) throw ruleViolation([{ code: 'DATE_RANGE_INVALID' }]);
      const row = await db.transaction(async (tx) => {
        const [a] = await tx
          .insert(distributorAgreements)
          .values({ ...body, distributorId: id, createdBy: authOf(req).user.id })
          .returning();
        await recordAudit(tx, actorOf(req), {
          action: 'CREATE',
          category: 'CONTRACT',
          entityType: 'distributor_agreement',
          entityId: a!.id,
          changes: [
            { field: 'marginPct', old: null, new: body.marginPct },
            { field: 'endsOn', old: null, new: body.endsOn },
          ],
        });
        return a;
      });
      return reply.status(201).send(ok(row));
    },
  );

  app.post(
    '/distributors/:id/trainings',
    { config: { guard: { process: 'P13', action: 'write' } } },
    async (req, reply) => {
      const { id } = parse(idParam, req.params);
      const body = parse(TrainingSchema, req.body);
      const [t] = await db
        .insert(distributorTrainings)
        .values({ ...body, distributorId: id, createdBy: authOf(req).user.id })
        .returning();
      return reply.status(201).send(ok(t));
    },
  );

  app.get(
    '/deal-registrations',
    { config: { guard: { process: 'P13', action: 'view' } } },
    async () =>
      ok(
        await db
          .select({
            r: dealRegistrations,
            accountName: accounts.name,
            distributorName: distributors.name,
          })
          .from(dealRegistrations)
          .innerJoin(accounts, eq(accounts.id, dealRegistrations.accountId))
          .innerJoin(distributors, eq(distributors.id, dealRegistrations.distributorId))
          .orderBy(desc(dealRegistrations.registeredOn))
          .then((rows) =>
            rows.map((r) => ({
              ...r.r,
              accountName: r.accountName,
              distributorName: r.distributorName,
            })),
          ),
      ),
  );

  /** P13-02: registration with channel-conflict detection → CONFLICT_REVIEW until the CM decides. */
  app.post(
    '/deal-registrations',
    { config: { guard: { process: 'P13', action: 'write' } } },
    async (req, reply) => {
      const body = parse(DealRegistrationSchema, req.body);
      const ctx = await rules.get();
      const [acc] = await db.select().from(accounts).where(eq(accounts.id, body.accountId));
      if (!acc) throw notFound();
      const agr = await distributorAgreementFailures(db, body.distributorId, {
        today: req.today,
        country: acc.countryCode,
      });
      if (agr.length && ctx.settings['distributors.blockExpiredAgreement'])
        throw ruleViolation(agr);
      const open = await db
        .select({
          id: opportunities.id,
          accountId: opportunities.accountId,
          distributorId: opportunities.distributorId,
          status: opportunities.status,
        })
        .from(opportunities)
        .where(
          and(
            eq(opportunities.accountId, body.accountId),
            eq(opportunities.status, 'OPEN'),
            sql`${opportunities.stage} < 7`,
          ),
        );
      const regs = await db
        .select({
          id: dealRegistrations.id,
          accountId: dealRegistrations.accountId,
          distributorId: dealRegistrations.distributorId,
          status: dealRegistrations.status,
        })
        .from(dealRegistrations)
        .where(eq(dealRegistrations.accountId, body.accountId));
      const c = detectChannelConflict(
        body,
        open.filter((o) => o.id !== body.opportunityId),
        regs,
      );
      const row = await db.transaction(async (tx) => {
        const [r] = await tx
          .insert(dealRegistrations)
          .values({
            ...body,
            opportunityId: body.opportunityId ?? null,
            notes: body.notes ?? null,
            status: c.conflict ? 'CONFLICT_REVIEW' : 'SUBMITTED',
            conflictingOpportunityIds: c.opportunityIds,
            createdBy: authOf(req).user.id,
          })
          .returning();
        await recordAudit(tx, actorOf(req), {
          action: 'CREATE',
          category: 'DATA',
          entityType: 'deal_registration',
          entityId: r!.id,
          accountId: body.accountId,
          changes: [{ field: 'status', old: null, new: r!.status }],
        });
        await notify(
          tx,
          {
            roles: ['COUNTRY_MANAGER'],
            type: c.conflict ? 'CHANNEL_CONFLICT' : 'DEAL_REGISTRATION',
            titleKey: c.conflict ? 'channelConflict' : 'dealRegistration',
            params: { account: acc.name },
            entityType: 'deal_registration',
            entityId: r!.id,
            link: '/distribuidores',
            dedupeKey: `registration:${r!.id}`,
          },
          mailer,
        );
        return r;
      });
      return reply.status(201).send(ok({ ...row, conflict: c }));
    },
  );

  app.post(
    '/deal-registrations/:id/decision',
    { config: { guard: { process: 'P13', action: 'approve', actionRole: 'P13.conflict.decide' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const body = parse(RegistrationDecisionSchema, req.body);
      return ok(
        await db.transaction(async (tx) => {
          const [r] = await tx
            .select()
            .from(dealRegistrations)
            .where(eq(dealRegistrations.id, id))
            .for('update');
          if (!r) throw notFound();
          if (!['SUBMITTED', 'CONFLICT_REVIEW'].includes(r.status))
            throw ruleViolation([{ code: 'STATUS_INVALID', params: { status: r.status } }]);
          const [after] = await tx
            .update(dealRegistrations)
            .set({
              status: body.status,
              decidedBy: authOf(req).user.id,
              decidedAt: new Date(),
              decisionReason: body.reason,
              updatedAt: new Date(),
            })
            .where(eq(dealRegistrations.id, id))
            .returning();
          await recordAudit(tx, actorOf(req), {
            action: 'APPROVAL_DECISION',
            category: r.status === 'CONFLICT_REVIEW' ? 'EXCEPTION' : 'APPROVAL',
            entityType: 'deal_registration',
            entityId: id,
            accountId: r.accountId,
            changes: [{ field: 'status', old: r.status, new: body.status }],
            reason: body.reason,
          });
          return after;
        }),
      );
    },
  );
}
