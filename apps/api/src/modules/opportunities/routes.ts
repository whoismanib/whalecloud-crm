import {
  BusinessCaseSchema,
  can,
  CloseSchema,
  DecisionSchema,
  evaluateStageGate,
  HandoffSchema,
  healthScore,
  isRegisteredLate,
  meddpiccScore,
  OpportunityContactsSchema,
  OpportunityCreateSchema,
  OpportunityUpdateSchema,
  QualificationSchema,
  transitionProcess,
  TransitionSchema,
  validateBusinessCaseSubmission,
  validateClose,
  validateOpportunityCreate,
  handoffDueOn,
  type ContactRole,
} from '@wcrm/shared';
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { diffFields, recordAudit } from '../../audit/record';
import {
  accounts,
  approvalRequests,
  auditLog,
  attachments,
  businessCases,
  contacts,
  contracts,
  handoffs,
  opportunities,
  opportunityContacts,
  opportunityQualifications,
  stageHistory,
  users,
} from '../../db/schema/index';
import {
  AppError,
  assertRules,
  conflict,
  gateFailed,
  notFound,
  ruleViolation,
} from '../../lib/errors';
import { actorOf, authOf, ok } from '../../lib/http';
import { parse } from '../../lib/validate';
import { moneyColumns, moneyOut } from '../../services/money';
import {
  assertVisible,
  buildGateContext,
  changeStage,
  loadQualification,
  lockOpportunity,
  visibilityFilter,
} from '../../services/opportunities';
import { invalidateApproval } from '../approvals/service';
import { distributorAgreementFailures } from '../distributors/routes';

const OPP_FIELDS = [
  'name',
  'amount',
  'amountCurrency',
  'billingEngine',
  'expectedCloseDate',
  'decisionDate',
  'pain',
  'sponsorContactId',
  'decisionCriteria',
  'forecastCategory',
  'risk',
  'zmpProjectId',
  'chinaSystemContractId',
  'competitors',
] as const;

const ListQuery = z.object({
  q: z.string().optional(),
  stage: z.string().optional(),
  status: z.string().optional(),
  accountId: z.string().uuid().optional(),
  ownerId: z.string().uuid().optional(),
});

export async function opportunityRoutes(app: FastifyInstance) {
  const { db, rules } = app.ctx;
  const idParam = z.object({ id: z.string().uuid() });

  async function getVisible(req: Parameters<typeof authOf>[0], id: string) {
    const [o] = await db.select().from(opportunities).where(eq(opportunities.id, id));
    if (!o) throw notFound();
    await assertVisible(db, authOf(req), o, (await rules.get()).raci);
    return o;
  }

  app.get('/opportunities', { config: { session: true, guard: undefined } }, async (req) => {
    const auth = authOf(req);
    const q = parse(ListQuery, req.query);
    const { raci } = await rules.get();
    const where: SQL[] = [visibilityFilter(auth, raci), sql`${opportunities.archivedAt} IS NULL`];
    if (q.q) {
      where.push(
        or(
          ilike(opportunities.name, `%${q.q}%`),
          ilike(opportunities.code, `%${q.q}%`),
          ilike(accounts.name, `%${q.q}%`),
        )!,
      );
    }
    if (q.stage) where.push(inArray(opportunities.stage, q.stage.split(',').map(Number)));
    if (q.status)
      where.push(
        sql`${opportunities.status}::text IN (${sql.join(
          q.status.split(',').map((s) => sql`${s}`),
          sql`, `,
        )})`,
      );
    if (q.accountId) where.push(eq(opportunities.accountId, q.accountId));
    if (q.ownerId) where.push(eq(opportunities.ownerId, q.ownerId));
    const rows = await db
      .select({
        o: opportunities,
        accountName: accounts.name,
        ownerName: users.fullName,
      })
      .from(opportunities)
      .innerJoin(accounts, eq(accounts.id, opportunities.accountId))
      .innerJoin(users, eq(users.id, opportunities.ownerId))
      .where(and(...where))
      .orderBy(asc(opportunities.stage), desc(opportunities.amountUsd));
    return ok(rows.map((r) => ({ ...r.o, accountName: r.accountName, ownerName: r.ownerName })));
  });

  app.post(
    '/opportunities',
    { config: { guard: { process: 'P1', action: 'write' } } },
    async (req, reply) => {
      const pre = validateOpportunityCreate((req.body ?? {}) as Record<string, string>);
      if (!pre.ok) throw ruleViolation(pre.failures);
      const body = parse(OpportunityCreateSchema, req.body);
      const auth = authOf(req);
      const ctx = await rules.get();
      const [contact] = await db.select().from(contacts).where(eq(contacts.id, body.contactId));
      if (!contact || contact.accountId !== body.accountId) {
        throw ruleViolation([{ code: 'CONTACT_NOT_IN_ACCOUNT' }]);
      }
      if (body.distributorId) {
        const agr = await distributorAgreementFailures(db, body.distributorId, {
          today: req.today,
          country: body.countryCode,
          vertical: body.vertical,
        });
        if (agr.length && ctx.settings['distributors.blockExpiredAgreement'])
          throw ruleViolation(agr);
      }
      const registeredLate = isRegisteredLate(
        body.firstContactDate,
        req.today,
        ctx.calendars.CL!,
        ctx.settings['sla.businessDays'].P1_REGISTRATION,
      );
      const row = await db.transaction(async (tx) => {
        const seq = await tx.execute<{ n: string }>(
          sql`SELECT nextval('opportunity_code_seq')::text AS n`,
        );
        const code = `OPP-${req.today.slice(0, 4)}-${seq.rows[0]!.n.padStart(4, '0')}`;
        const [o] = await tx
          .insert(opportunities)
          .values({
            code,
            name: body.name,
            accountId: body.accountId,
            ownerId: body.ownerId ?? auth.user.id,
            countryCode: body.countryCode,
            vertical: body.vertical,
            billingEngine: body.billingEngine,
            origin: body.origin,
            distributorId: body.distributorId ?? null,
            ...moneyColumns('amount', body.amount, body.currency, body.expectedCloseDate, ctx.fx),
            expectedCloseDate: body.expectedCloseDate,
            firstContactDate: body.firstContactDate,
            registeredLate,
            forecastCategory: body.forecastCategory ?? null,
            risk: body.risk ?? null,
            countsAsDigital: ctx.settings['digital.verticals'].includes(body.vertical),
            createdBy: auth.user.id,
            updatedBy: auth.user.id,
          })
          .returning();
        await tx.insert(opportunityQualifications).values({ opportunityId: o!.id });
        await tx
          .insert(opportunityContacts)
          .values({ opportunityId: o!.id, contactId: contact.id, roles: contact.buyingRoles });
        await tx.insert(stageHistory).values({
          opportunityId: o!.id,
          fromStage: null,
          toStage: 0,
          toStatus: 'OPEN',
          changedBy: auth.user.id,
        });
        await recordAudit(tx, actorOf(req), {
          action: 'CREATE',
          category: 'DATA',
          entityType: 'opportunity',
          entityId: o!.id,
          opportunityId: o!.id,
          accountId: o!.accountId,
          changes: diffFields(null, o!, OPP_FIELDS),
        });
        return o!;
      });
      return reply.status(201).send(ok({ ...row, amountMoney: moneyOut(row, 'amount') }));
    },
  );

  app.get('/opportunities/:id', { config: { session: true } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const o = await getVisible(req, id);
    const ctx = await rules.get();
    const [acc] = await db.select().from(accounts).where(eq(accounts.id, o.accountId));
    const [owner] = await db
      .select({ fullName: users.fullName })
      .from(users)
      .where(eq(users.id, o.ownerId));
    const qual = await loadQualification(db, id);
    const cs = await db
      .select({ contact: contacts, roles: opportunityContacts.roles })
      .from(opportunityContacts)
      .innerJoin(contacts, eq(contacts.id, opportunityContacts.contactId))
      .where(eq(opportunityContacts.opportunityId, id));
    const history = await db
      .select()
      .from(stageHistory)
      .where(eq(stageHistory.opportunityId, id))
      .orderBy(asc(stageHistory.changedAt));
    const approval = o.currentApprovalRequestId
      ? (
          await db
            .select()
            .from(approvalRequests)
            .where(eq(approvalRequests.id, o.currentApprovalRequestId))
        )[0]
      : null;
    const [h] = await db.select().from(handoffs).where(eq(handoffs.opportunityId, id));
    const bcs = await db
      .select()
      .from(businessCases)
      .where(eq(businessCases.opportunityId, id))
      .orderBy(desc(businessCases.version));
    let nextGate = null;
    if (o.status === 'OPEN' && o.stage < 8) {
      const g = evaluateStageGate(
        await buildGateContext(db, o, ctx.settings),
        o.stage,
        o.stage + 1,
        ctx.settings,
        req.today,
      );
      nextGate = { toStage: o.stage + 1, ...g };
    }
    const lastActivity = o.lastActivityAt ? o.lastActivityAt.toISOString().slice(0, 10) : null;
    const health = healthScore(
      {
        status: o.status,
        stage: o.stage,
        onHold: o.onHold,
        lastActivityOn: lastActivity,
        lastUpdatedOn: o.updatedAt.toISOString().slice(0, 10),
        expectedCloseDate: o.expectedCloseDate,
        overdueSlaCount: 0,
        risk: o.risk,
        today: req.today,
      },
      ctx.calendars.CL!,
      ctx.settings,
    );
    return ok({
      ...o,
      amountMoney: moneyOut(o, 'amount'),
      account: acc,
      ownerName: owner?.fullName ?? null,
      qualification: { ...qual, meddpiccScore: meddpiccScore(qual) },
      contacts: cs.map((c) => ({ ...c.contact, roles: c.roles })),
      stageHistory: history,
      approval,
      handoff: h ?? null,
      businessCases: bcs,
      nextGate,
      health,
    });
  });

  app.patch(
    '/opportunities/:id',
    { config: { session: true, guard: { process: 'P2', action: 'view' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const body = parse(OpportunityUpdateSchema, req.body);
      const auth = authOf(req);
      const ctx = await rules.get();
      return ok(
        await db.transaction(async (tx) => {
          const before = await lockOpportunity(tx, id);
          await assertVisible(tx, auth, before, ctx.raci);
          const proc = transitionProcess(Math.max(before.stage, 1));
          if (
            !can(auth.roles, proc, 'write', ctx.raci) &&
            !can(auth.roles, 'P2', 'write', ctx.raci)
          ) {
            throw new AppError(403, 'FORBIDDEN');
          }
          if (before.rowVersion !== body.rowVersion) throw conflict();
          const { rowVersion, reason, amount, currency, ...rest } = body;
          const patch: Record<string, unknown> = { ...rest };
          const amountChanged =
            (amount !== undefined && amount !== before.amount) ||
            (currency !== undefined && currency !== before.amountCurrency);
          if (amountChanged) {
            Object.assign(
              patch,
              moneyColumns(
                'amount',
                amount ?? before.amount,
                currency ?? before.amountCurrency,
                body.expectedCloseDate ?? before.expectedCloseDate,
                ctx.fx,
              ),
            );
          }
          const [after] = await tx
            .update(opportunities)
            .set({
              ...patch,
              rowVersion: rowVersion + 1,
              updatedAt: new Date(),
              updatedBy: auth.user.id,
            })
            .where(eq(opportunities.id, id))
            .returning();
          const changes = diffFields(before, after!, OPP_FIELDS);
          const scopeChanged =
            amountChanged ||
            (body.billingEngine !== undefined && body.billingEngine !== before.billingEngine);
          await recordAudit(tx, actorOf(req), {
            action: 'UPDATE',
            category: scopeChanged ? 'SCOPE' : 'DATA',
            entityType: 'opportunity',
            entityId: id,
            opportunityId: id,
            accountId: before.accountId,
            changes,
            reason: reason ?? null,
          });
          // P6-05: scope/engine/amount change invalidates the current approval
          if (scopeChanged && before.currentApprovalRequestId) {
            await invalidateApproval(
              tx,
              before.currentApprovalRequestId,
              actorOf(req),
              'SCOPE_CHANGED',
            );
          }
          return after;
        }),
      );
    },
  );

  app.get('/opportunities/:id/gates', { config: { session: true } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const { toStage } = parse(z.object({ toStage: z.coerce.number().int() }), req.query);
    const o = await getVisible(req, id);
    const ctx = await rules.get();
    return ok(
      evaluateStageGate(
        await buildGateContext(db, o, ctx.settings),
        o.stage,
        toStage,
        ctx.settings,
        req.today,
        {
          status: o.status,
          reason: 'dry-run',
        },
      ),
    );
  });

  app.post(
    '/opportunities/:id/transitions',
    {
      config: {
        session: true,
        guard: { process: 'P1', action: 'view', extra: 'write on transitionProcess(toStage)' },
      },
    },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const body = parse(TransitionSchema, req.body);
      const auth = authOf(req);
      const ctx = await rules.get();
      return ok(
        await db.transaction(async (tx) => {
          const o = await lockOpportunity(tx, id);
          await assertVisible(tx, auth, o, ctx.raci);
          if (!can(auth.roles, transitionProcess(body.toStage), 'write', ctx.raci)) {
            throw new AppError(403, 'FORBIDDEN');
          }
          const r = evaluateStageGate(
            await buildGateContext(tx, o, ctx.settings),
            o.stage,
            body.toStage,
            ctx.settings,
            req.today,
            {
              reason: body.reason,
              status: o.status,
            },
          );
          if (!r.ok) throw gateFailed(r.failures, o.stage, body.toStage);
          return changeStage(tx, o, body.toStage, actorOf(req), { reason: body.reason });
        }),
      );
    },
  );

  app.post(
    '/opportunities/:id/close',
    { config: { guard: { process: 'P2', action: 'write' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const body = parse(CloseSchema, req.body);
      const r = validateClose(body);
      if (!r.ok) throw ruleViolation(r.failures);
      const ctx = await rules.get();
      return ok(
        await db.transaction(async (tx) => {
          const o = await lockOpportunity(tx, id);
          await assertVisible(tx, authOf(req), o, ctx.raci);
          if (o.status !== 'OPEN') throw ruleViolation([{ code: 'OPPORTUNITY_CLOSED' }]);
          if (o.stage >= 7) throw ruleViolation([{ code: 'OPPORTUNITY_WON' }]);
          const [after] = await tx
            .update(opportunities)
            .set({
              status: body.status,
              closedAt: new Date(),
              closeReason: body.reason,
              winningCompetitor: body.winningCompetitor ?? null,
              ...moneyColumns(
                'winningPrice',
                body.winningPrice ?? null,
                body.winningPriceCurrency ?? null,
                req.today,
                ctx.fx,
              ),
              rowVersion: o.rowVersion + 1,
              updatedAt: new Date(),
            })
            .where(eq(opportunities.id, id))
            .returning();
          await tx.insert(stageHistory).values({
            opportunityId: id,
            fromStage: o.stage,
            toStage: o.stage,
            fromStatus: 'OPEN',
            toStatus: body.status,
            changedBy: authOf(req).user.id,
            reason: body.reason,
          });
          await recordAudit(tx, actorOf(req), {
            action: 'STAGE_CHANGE',
            category: 'STAGE',
            entityType: 'opportunity',
            entityId: id,
            opportunityId: id,
            accountId: o.accountId,
            changes: [{ field: 'status', old: 'OPEN', new: body.status }],
            reason: body.reason,
          });
          return after;
        }),
      );
    },
  );

  app.put(
    '/opportunities/:id/qualification',
    { config: { guard: { process: 'P2', action: 'write' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const body = parse(QualificationSchema, req.body);
      const ctx = await rules.get();
      return ok(
        await db.transaction(async (tx) => {
          const o = await lockOpportunity(tx, id);
          await assertVisible(tx, authOf(req), o, ctx.raci);
          const before = await loadQualification(tx, id);
          const score = meddpiccScore(body);
          const [after] = await tx
            .update(opportunityQualifications)
            .set({
              ...body,
              meddpiccScore: String(score),
              updatedAt: new Date(),
              updatedBy: authOf(req).user.id,
            })
            .where(eq(opportunityQualifications.opportunityId, id))
            .returning();
          await recordAudit(tx, actorOf(req), {
            action: 'UPDATE',
            category: 'DATA',
            entityType: 'qualification',
            entityId: id,
            opportunityId: id,
            accountId: o.accountId,
            changes: diffFields(
              before,
              after!,
              Object.keys(body).filter((k) => k !== 'notes'),
            ),
          });
          return { ...after, meddpiccScore: score };
        }),
      );
    },
  );

  app.put(
    '/opportunities/:id/contacts',
    { config: { guard: { process: 'P2', action: 'write' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const body = parse(OpportunityContactsSchema, req.body);
      const ctx = await rules.get();
      return ok(
        await db.transaction(async (tx) => {
          const o = await lockOpportunity(tx, id);
          await assertVisible(tx, authOf(req), o, ctx.raci);
          if (body.length) {
            const cs = await tx
              .select({ id: contacts.id, accountId: contacts.accountId })
              .from(contacts)
              .where(
                inArray(
                  contacts.id,
                  body.map((b) => b.contactId),
                ),
              );
            if (cs.length !== body.length || cs.some((c) => c.accountId !== o.accountId)) {
              throw ruleViolation([{ code: 'CONTACT_NOT_IN_ACCOUNT' }]);
            }
          }
          await tx.delete(opportunityContacts).where(eq(opportunityContacts.opportunityId, id));
          if (body.length) {
            await tx.insert(opportunityContacts).values(
              body.map((b) => ({
                opportunityId: id,
                contactId: b.contactId,
                roles: b.roles as ContactRole[],
              })),
            );
          }
          await recordAudit(tx, actorOf(req), {
            action: 'UPDATE',
            category: 'DATA',
            entityType: 'opportunity_contacts',
            entityId: id,
            opportunityId: id,
            changes: [{ field: 'contacts', old: null, new: body }],
          });
          return body;
        }),
      );
    },
  );

  app.get('/opportunities/:id/timeline', { config: { session: true } }, async (req) => {
    const { id } = parse(idParam, req.params);
    await getVisible(req, id);
    const { category } = parse(z.object({ category: z.string().optional() }), req.query);
    const where: SQL[] = [eq(auditLog.opportunityId, id)];
    if (category) {
      where.push(
        sql`${auditLog.category}::text IN (${sql.join(
          category.split(',').map((c) => sql`${c}`),
          sql`, `,
        )})`,
      );
    }
    const rows = await db
      .select({
        id: auditLog.id,
        occurredAt: auditLog.occurredAt,
        action: auditLog.action,
        category: auditLog.category,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        changes: auditLog.changes,
        reason: auditLog.reason,
        actorName: users.fullName,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorUserId))
      .where(and(...where))
      .orderBy(desc(auditLog.id))
      .limit(500);
    return ok(rows);
  });

  // ---------- P9 hand-off (minimal, needed by gate 7→8) ----------
  app.post(
    '/opportunities/:id/handoff',
    { config: { guard: { process: 'P9', action: 'write' } } },
    async (req, reply) => {
      const { id } = parse(idParam, req.params);
      const body = parse(HandoffSchema, req.body);
      const ctx = await rules.get();
      const row = await db.transaction(async (tx) => {
        const o = await lockOpportunity(tx, id);
        await assertVisible(tx, authOf(req), o, ctx.raci);
        if (o.stage < 7) throw ruleViolation([{ code: 'OPPORTUNITY_NOT_WON' }]);
        // P9-01: SLA counts from the signature date of the signed contract (fallback: won date)
        const [signed] = await tx
          .select({ signedOn: contracts.signedOn, id: contracts.id })
          .from(contracts)
          .where(and(eq(contracts.opportunityId, id), sql`${contracts.signedOn} IS NOT NULL`))
          .orderBy(desc(contracts.signedOn))
          .limit(1);
        const signedOn = signed?.signedOn ?? o.wonAt?.toISOString().slice(0, 10) ?? null;
        let sowAttachmentId: string | null = null;
        if (body.sowUrl) {
          const [att] = await tx
            .insert(attachments)
            .values({
              externalUrl: body.sowUrl,
              standardName: body.sowUrl.split('/').pop() ?? 'SOW',
              docKind: 'SOW',
              entityType: 'handoff',
              accountId: o.accountId,
              opportunityId: id,
            })
            .returning({ id: attachments.id });
          sowAttachmentId = att!.id;
        }
        const values = {
          opportunityId: id,
          contractId: signed?.id ?? null,
          meetingAt: new Date(
            body.meetingAt.length === 10 ? `${body.meetingAt}T12:00:00Z` : body.meetingAt,
          ),
          attendeeUserIds: body.attendeeUserIds,
          externalAttendees: body.externalAttendees ?? null,
          acceptanceCriteria: body.acceptanceCriteria ?? null,
          zmpProjectId: body.zmpProjectId,
          plannedStart: body.plannedStart ?? null,
          actualStart: body.actualStart ?? null,
          commercialSheetReviewed: body.commercialSheetReviewed,
          sowReviewed: body.sowReviewed,
          milestonesReviewed: body.milestonesReviewed,
          acceptanceCriteriaReviewed: body.acceptanceCriteriaReviewed,
          ...(sowAttachmentId ? { sowAttachmentId } : {}),
          notes: body.notes ?? null,
          dueOn: signedOn
            ? handoffDueOn(signedOn, ctx.calendars.CL!, ctx.settings['sla.businessDays'].P9_HANDOFF)
            : null,
          createdBy: authOf(req).user.id,
        };
        const [h] = await tx
          .insert(handoffs)
          .values(values)
          .onConflictDoUpdate({
            target: handoffs.opportunityId,
            set: { ...values, updatedAt: new Date() },
          })
          .returning();
        await tx
          .update(opportunities)
          .set({ zmpProjectId: body.zmpProjectId })
          .where(eq(opportunities.id, id));
        await recordAudit(tx, actorOf(req), {
          action: 'CREATE',
          category: 'SCOPE',
          entityType: 'handoff',
          entityId: h!.id,
          opportunityId: id,
          accountId: o.accountId,
          changes: [{ field: 'zmpProjectId', old: o.zmpProjectId, new: body.zmpProjectId }],
        });
        return h;
      });
      return reply.status(201).send(ok(row));
    },
  );

  // ---------- P4 business cases ----------
  app.post(
    '/opportunities/:id/business-cases',
    { config: { guard: { process: 'P4', action: 'write' } } },
    async (req, reply) => {
      const { id } = parse(idParam, req.params);
      const body = parse(BusinessCaseSchema, req.body);
      const ctx = await rules.get();
      const row = await db.transaction(async (tx) => {
        const o = await lockOpportunity(tx, id);
        await assertVisible(tx, authOf(req), o, ctx.raci);
        const [{ v } = { v: 0 }] = await tx
          .select({ v: sql<number>`coalesce(max(${businessCases.version}),0)::int` })
          .from(businessCases)
          .where(eq(businessCases.opportunityId, id));
        const { tco, tcoCurrency, ...rest } = body;
        const [bc] = await tx
          .insert(businessCases)
          .values({
            ...rest,
            roiPct: rest.roiPct ?? null,
            paybackMonths: rest.paybackMonths ?? null,
            ...moneyColumns('tco', tco ?? null, tcoCurrency ?? null, req.today, ctx.fx),
            opportunityId: id,
            version: v + 1,
            createdBy: authOf(req).user.id,
          })
          .returning();
        await tx
          .update(opportunities)
          .set({ usesBusinessCase: true })
          .where(eq(opportunities.id, id));
        await recordAudit(tx, actorOf(req), {
          action: 'CREATE',
          category: 'SCOPE',
          entityType: 'business_case',
          entityId: bc!.id,
          opportunityId: id,
          accountId: o.accountId,
        });
        return bc;
      });
      return reply.status(201).send(ok(row));
    },
  );

  app.post(
    '/business-cases/:id/submit',
    { config: { guard: { process: 'P4', action: 'write' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      return ok(
        await db.transaction(async (tx) => {
          const [bc] = await tx
            .select()
            .from(businessCases)
            .where(eq(businessCases.id, id))
            .for('update');
          if (!bc) throw notFound();
          if (bc.status !== 'DRAFT')
            throw ruleViolation([{ code: 'STATUS_INVALID', params: { status: bc.status } }]);
          assertRules(validateBusinessCaseSubmission(bc));
          const [after] = await tx
            .update(businessCases)
            .set({ status: 'SUBMITTED', submittedAt: new Date(), updatedAt: new Date() })
            .where(eq(businessCases.id, id))
            .returning();
          await recordAudit(tx, actorOf(req), {
            action: 'UPDATE',
            category: 'SCOPE',
            entityType: 'business_case',
            entityId: id,
            opportunityId: bc.opportunityId,
            changes: [{ field: 'status', old: 'DRAFT', new: 'SUBMITTED' }],
          });
          return after;
        }),
      );
    },
  );

  app.post(
    '/business-cases/:id/decision',
    { config: { guard: { process: 'P4', action: 'approve' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const body = parse(DecisionSchema, req.body);
      if (body.decision !== 'APPROVED' && !body.comment?.trim()) {
        throw ruleViolation([{ code: 'COMMENT_REQUIRED' }]);
      }
      return ok(
        await db.transaction(async (tx) => {
          const [bc] = await tx
            .select()
            .from(businessCases)
            .where(eq(businessCases.id, id))
            .for('update');
          if (!bc) throw notFound();
          if (bc.status !== 'SUBMITTED')
            throw ruleViolation([{ code: 'STATUS_INVALID', params: { status: bc.status } }]);
          const status = body.decision === 'APPROVED' ? 'APPROVED' : 'REJECTED';
          const [after] = await tx
            .update(businessCases)
            .set({
              status,
              approvedBy: status === 'APPROVED' ? authOf(req).user.id : null,
              approvedAt: status === 'APPROVED' ? new Date() : null,
              decisionComment: body.comment ?? null,
              updatedAt: new Date(),
            })
            .where(eq(businessCases.id, id))
            .returning();
          await recordAudit(tx, actorOf(req), {
            action: 'APPROVAL_DECISION',
            category: 'APPROVAL',
            entityType: 'business_case',
            entityId: id,
            opportunityId: bc.opportunityId,
            changes: [{ field: 'status', old: bc.status, new: status }],
            reason: body.comment ?? null,
          });
          return after;
        }),
      );
    },
  );
}
