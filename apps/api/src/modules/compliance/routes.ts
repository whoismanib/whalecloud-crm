import {
  COMPLIANCE_ITEMS,
  complianceFailures,
  ComplianceItemsSchema,
  ComplianceReviewSchema,
  requiredComplianceSections,
  type LineItemType,
} from '@wcrm/shared';
import { asc, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { recordAudit } from '../../audit/record';
import type { DbOrTx } from '../../db/client';
import {
  complianceChecklists,
  complianceItems,
  opportunities,
  sheetLineItems,
} from '../../db/schema/index';
import { assertRules, notFound, ruleViolation } from '../../lib/errors';
import { actorOf, authOf, ok } from '../../lib/http';
import { parse } from '../../lib/validate';
import { notify } from '../../services/notify';
import { assertVisible } from '../../services/opportunities';

async function loadChecklist(db: DbOrTx, id: string) {
  const [c] = await db.select().from(complianceChecklists).where(eq(complianceChecklists.id, id));
  if (!c) throw notFound();
  const items = await db
    .select()
    .from(complianceItems)
    .where(eq(complianceItems.checklistId, id))
    .orderBy(asc(complianceItems.section));
  return { ...c, items };
}

/**
 * P14: compliance checklist per opportunity (Ley 21.719, anti-corruption, public tender, export
 * control). Reviewed by China Legal, approved by the CM; gate 4→5 requires it approved.
 */
export async function complianceRoutes(app: FastifyInstance) {
  const { db, rules, mailer } = app.ctx;
  const idParam = z.object({ id: z.string().uuid() });

  app.get(
    '/opportunities/:id/compliance-checklists',
    { config: { guard: { process: 'P14', action: 'view' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const list = await db
        .select()
        .from(complianceChecklists)
        .where(eq(complianceChecklists.opportunityId, id))
        .orderBy(desc(complianceChecklists.version));
      return ok(
        list[0]
          ? { current: await loadChecklist(db, list[0].id), versions: list }
          : { current: null, versions: [] },
      );
    },
  );

  app.post(
    '/opportunities/:id/compliance-checklists',
    { config: { guard: { process: 'P14', action: 'write' } } },
    async (req, reply) => {
      const { id } = parse(idParam, req.params);
      const ctx = await rules.get();
      const row = await db.transaction(async (tx) => {
        const [o] = await tx.select().from(opportunities).where(eq(opportunities.id, id));
        if (!o) throw notFound();
        await assertVisible(tx, authOf(req), o, ctx.raci);
        const types = o.currentSheetVersionId
          ? (
              await tx
                .select({ t: sheetLineItems.itemType })
                .from(sheetLineItems)
                .where(eq(sheetLineItems.sheetVersionId, o.currentSheetVersionId))
            ).map((x) => x.t as LineItemType)
          : [];
        const required = requiredComplianceSections(o.billingEngine, types);
        const [{ v } = { v: 0 }] = await tx
          .select({ v: sql<number>`coalesce(max(${complianceChecklists.version}),0)::int` })
          .from(complianceChecklists)
          .where(eq(complianceChecklists.opportunityId, id));
        const [c] = await tx
          .insert(complianceChecklists)
          .values({
            opportunityId: id,
            version: v + 1,
            requiredSections: required,
            createdBy: authOf(req).user.id,
          })
          .returning();
        await tx.insert(complianceItems).values(
          COMPLIANCE_ITEMS.map((i) => ({
            checklistId: c!.id,
            section: i.section,
            itemCode: i.code,
            required: required.includes(i.section),
          })),
        );
        await recordAudit(tx, actorOf(req), {
          action: 'CREATE',
          category: 'EXCEPTION',
          entityType: 'compliance_checklist',
          entityId: c!.id,
          opportunityId: id,
          changes: [{ field: 'requiredSections', old: null, new: required }],
        });
        return loadChecklist(tx, c!.id);
      });
      return reply.status(201).send(ok(row));
    },
  );

  app.put(
    '/compliance-checklists/:id/items',
    { config: { guard: { process: 'P14', action: 'write' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const body = parse(ComplianceItemsSchema, req.body);
      return ok(
        await db.transaction(async (tx) => {
          const c = await loadChecklist(tx, id);
          if (!['DRAFT', 'REJECTED'].includes(c.status))
            throw ruleViolation([{ code: 'STATUS_INVALID', params: { status: c.status } }]);
          for (const it of body) {
            await tx
              .update(complianceItems)
              .set({ answer: it.answer, notes: it.notes ?? null })
              .where(
                sql`${complianceItems.checklistId} = ${id} AND ${complianceItems.itemCode} = ${it.itemCode}`,
              );
          }
          if (c.status === 'REJECTED')
            await tx
              .update(complianceChecklists)
              .set({ status: 'DRAFT' })
              .where(eq(complianceChecklists.id, id));
          return loadChecklist(tx, id);
        }),
      );
    },
  );

  app.post(
    '/compliance-checklists/:id/submit',
    { config: { guard: { process: 'P14', action: 'write' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      return ok(
        await db.transaction(async (tx) => {
          const c = await loadChecklist(tx, id);
          if (c.status !== 'DRAFT')
            throw ruleViolation([{ code: 'STATUS_INVALID', params: { status: c.status } }]);
          assertRules(complianceFailures(c.items, c.requiredSections));
          await tx
            .update(complianceChecklists)
            .set({ status: 'IN_REVIEW', updatedAt: new Date() })
            .where(eq(complianceChecklists.id, id));
          await recordAudit(tx, actorOf(req), {
            action: 'UPDATE',
            category: 'EXCEPTION',
            entityType: 'compliance_checklist',
            entityId: id,
            opportunityId: c.opportunityId,
            changes: [{ field: 'status', old: 'DRAFT', new: 'IN_REVIEW' }],
          });
          await notify(
            tx,
            {
              roles: ['CHINA_LEGAL'],
              type: 'COMPLIANCE_REVIEW',
              titleKey: 'complianceReview',
              entityType: 'opportunity',
              entityId: c.opportunityId,
              link: `/oportunidades/${c.opportunityId}`,
              dedupeKey: `compliance:${id}:review`,
            },
            mailer,
          );
          return loadChecklist(tx, id);
        }),
      );
    },
  );

  app.post(
    '/compliance-checklists/:id/review',
    { config: { guard: { process: 'P14', action: 'write', actionRole: 'P14.checklist.review' } } },
    async (req) => {
      const { id } = parse(idParam, req.params);
      const body = parse(ComplianceReviewSchema, req.body);
      if (body.status === 'REJECTED' && !body.comment?.trim())
        throw ruleViolation([{ code: 'COMMENT_REQUIRED' }]);
      return ok(
        await db.transaction(async (tx) => {
          const c = await loadChecklist(tx, id);
          if (c.status !== 'IN_REVIEW')
            throw ruleViolation([{ code: 'STATUS_INVALID', params: { status: c.status } }]);
          await tx
            .update(complianceChecklists)
            .set({
              status: body.status,
              reviewedBy: authOf(req).user.id,
              reviewedAt: new Date(),
              reviewComment: body.comment ?? null,
            })
            .where(eq(complianceChecklists.id, id));
          await recordAudit(tx, actorOf(req), {
            action: 'APPROVAL_DECISION',
            category: 'EXCEPTION',
            entityType: 'compliance_checklist',
            entityId: id,
            opportunityId: c.opportunityId,
            changes: [{ field: 'status', old: 'IN_REVIEW', new: body.status }],
            reason: body.comment ?? null,
          });
          return loadChecklist(tx, id);
        }),
      );
    },
  );

  app.post(
    '/compliance-checklists/:id/approve',
    {
      config: { guard: { process: 'P14', action: 'approve', actionRole: 'P14.checklist.approve' } },
    },
    async (req) => {
      const { id } = parse(idParam, req.params);
      return ok(
        await db.transaction(async (tx) => {
          const c = await loadChecklist(tx, id);
          if (c.status !== 'REVIEWED')
            throw ruleViolation([
              { code: 'COMPLIANCE_NOT_REVIEWED', params: { status: c.status } },
            ]);
          await tx
            .update(complianceChecklists)
            .set({ status: 'APPROVED', approvedBy: authOf(req).user.id, approvedAt: new Date() })
            .where(eq(complianceChecklists.id, id));
          await recordAudit(tx, actorOf(req), {
            action: 'APPROVAL_DECISION',
            category: 'APPROVAL',
            entityType: 'compliance_checklist',
            entityId: id,
            opportunityId: c.opportunityId,
            changes: [{ field: 'status', old: 'REVIEWED', new: 'APPROVED' }],
          });
          return loadChecklist(tx, id);
        }),
      );
    },
  );
}
