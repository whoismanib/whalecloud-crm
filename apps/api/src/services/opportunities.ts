import {
  canViewOpportunity,
  handoffChecklistMissing,
  deriveStageFromMilestones,
  detectConditions,
  type GateContext,
  type MilestoneStatus,
  type NonEconomicCondition,
  type OpportunityStatus,
  type Qualification,
  type Raci,
  type Settings,
  type UserRole,
  visibleStages,
  GLOBAL_COUNTRY_ROLES,
} from '@wcrm/shared';
import { and, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import {
  accounts,
  approvalRequests,
  attachments,
  businessCases,
  complianceChecklists,
  contracts,
  handoffs,
  milestones,
  opportunities,
  opportunityAssignments,
  opportunityQualifications,
  priceRequests,
  sheetMilestones,
  sheetVersions,
  stageHistory,
  userRoles,
} from '../db/schema/index';
import { recordAudit, type Actor } from '../audit/record';
import { notFound } from '../lib/errors';
import type { AuthInfo } from '../types';

export type OpportunityRow = typeof opportunities.$inferSelect;

export async function lockOpportunity(tx: DbOrTx, id: string): Promise<OpportunityRow> {
  const [o] = await tx.select().from(opportunities).where(eq(opportunities.id, id)).for('update');
  if (!o) throw notFound();
  return o;
}

/** SQL filter for opportunity visibility by stage→process RACI, country and assignments (§6.4). */
export function visibilityFilter(auth: AuthInfo, raci: Raci): SQL {
  const stages = visibleStages(auth.roles, raci);
  const allCountries =
    auth.user.countryCodes.includes('*') ||
    auth.roles.some((r) => GLOBAL_COUNTRY_ROLES.includes(r));
  const assigned = sql`${opportunities.id} IN (SELECT opportunity_id FROM opportunity_assignments WHERE user_id = ${auth.user.id})`;
  const stageOk = stages.length
    ? sql`${opportunities.stage} IN (${sql.join(
        stages.map((s) => sql`${s}`),
        sql`, `,
      )})`
    : sql`false`;
  const countryOk = allCountries
    ? sql`true`
    : sql`${opportunities.countryCode} IN (${sql.join(
        auth.user.countryCodes.map((c) => sql`${c}`),
        sql`, `,
      )})`;
  return sql`((${stageOk} AND ${countryOk}) OR ${assigned})`;
}

/** 404 when the opportunity is not visible (API.md §1.4: "también si existe pero no es visible"). */
export async function assertVisible(
  db: DbOrTx,
  auth: AuthInfo,
  opp: OpportunityRow,
  raci: Raci,
): Promise<void> {
  const [assigned] = await db
    .select({ id: opportunityAssignments.opportunityId })
    .from(opportunityAssignments)
    .where(
      and(
        eq(opportunityAssignments.opportunityId, opp.id),
        eq(opportunityAssignments.userId, auth.user.id),
      ),
    )
    .limit(1);
  if (
    !canViewOpportunity(
      auth.roles,
      { stage: opp.stage, countryCode: opp.countryCode },
      { countryCodes: auth.user.countryCodes, assigned: Boolean(assigned) },
      raci,
    )
  ) {
    throw notFound();
  }
}

export async function loadQualification(
  db: DbOrTx,
  oppId: string,
): Promise<Qualification & { notes: unknown; meddpiccScore: string | null }> {
  const [q] = await db
    .select()
    .from(opportunityQualifications)
    .where(eq(opportunityQualifications.opportunityId, oppId));
  if (!q) throw notFound();
  return q;
}

/** Loads everything the stage gates need (ARCHITECTURE §8.1). */
export async function buildGateContext(
  db: DbOrTx,
  opp: OpportunityRow,
  settings: Settings,
): Promise<GateContext> {
  const qual = await loadQualification(db, opp.id);
  const eb = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM opportunity_contacts oc JOIN contacts c ON c.id = oc.contact_id
    WHERE oc.opportunity_id = ${opp.id}
      AND ('ECONOMIC_BUYER' = ANY(oc.roles) OR 'ECONOMIC_BUYER' = ANY(c.buying_roles))`);

  const pr = opp.currentPriceRequestId
    ? (
        await db.select().from(priceRequests).where(eq(priceRequests.id, opp.currentPriceRequestId))
      )[0]
    : undefined;
  const sheet = opp.currentSheetVersionId
    ? (
        await db.select().from(sheetVersions).where(eq(sheetVersions.id, opp.currentSheetVersionId))
      )[0]
    : undefined;
  const ms = sheet
    ? await db.select().from(sheetMilestones).where(eq(sheetMilestones.sheetVersionId, sheet.id))
    : [];
  const approval = opp.currentApprovalRequestId
    ? (
        await db
          .select()
          .from(approvalRequests)
          .where(eq(approvalRequests.id, opp.currentApprovalRequestId))
      )[0]
    : undefined;
  const [bc] = await db
    .select({ id: businessCases.id })
    .from(businessCases)
    .where(and(eq(businessCases.opportunityId, opp.id), eq(businessCases.status, 'APPROVED')))
    .limit(1);

  const pendingConditions = pendingNonEconomic(sheet ?? null, approval ?? null, settings);

  const signed = await db
    .select({ repositoryUrl: contracts.repositoryUrl, standardName: attachments.standardName })
    .from(contracts)
    .leftJoin(attachments, eq(attachments.id, contracts.signedAttachmentId))
    .where(
      and(
        eq(contracts.opportunityId, opp.id),
        inArray(contracts.status, ['SIGNED', 'ACTIVE']),
        inArray(contracts.type, ['SOW', 'OC', 'CR', 'MSA']),
      ),
    )
    .orderBy(desc(contracts.signedOn))
    .limit(1);

  const [compliance] = await db
    .select({ id: complianceChecklists.id })
    .from(complianceChecklists)
    .where(
      and(
        eq(complianceChecklists.opportunityId, opp.id),
        eq(complianceChecklists.status, 'APPROVED'),
      ),
    )
    .limit(1);
  const [h] = await db.select().from(handoffs).where(eq(handoffs.opportunityId, opp.id));
  let attendeeRoles: UserRole[] = [];
  if (h && h.attendeeUserIds.length) {
    const rs = await db
      .select({ role: userRoles.role })
      .from(userRoles)
      .where(inArray(userRoles.userId, h.attendeeUserIds));
    attendeeRoles = rs.map((r) => r.role);
  }

  return {
    amountUsd: opp.amountUsd,
    pain: opp.pain,
    sponsorContactId: opp.sponsorContactId,
    decisionCriteria: opp.decisionCriteria,
    decisionDate: opp.decisionDate,
    qualification: qual,
    hasEconomicBuyer: (eb.rows[0]?.n ?? 0) > 0,
    priceRequestSubmitted: Boolean(pr && pr.status !== 'DRAFT' && pr.status !== 'CANCELLED'),
    approval: approval
      ? { status: approval.status, expiresOn: approval.expiresOn, netMargin: approval.netMargin }
      : null,
    currentNetMargin: sheet?.netMargin ?? null,
    businessCaseApproved: Boolean(bc),
    pendingConditions,
    complianceApproved: Boolean(compliance),
    cashflowMilestones: ms
      .filter((m) => m.source === 'CASHFLOW')
      .map((m) => ({ seq: m.seq, pct: m.pct, trigger: m.trigger })),
    tcMilestones: ms
      .filter((m) => m.source === 'TC')
      .map((m) => ({ seq: m.seq, pct: m.pct, trigger: m.trigger })),
    offerValidityDays: sheet?.offerValidityDays ?? null,
    signedContract: signed[0] ?? null,
    chinaSystemContractId: opp.chinaSystemContractId,
    handoff: h
      ? {
          attendeeRoles,
          zmpProjectId: h.zmpProjectId,
          checklistMissing: handoffChecklistMissing(h),
        }
      : null,
    zmpProjectId: opp.zmpProjectId,
  };
}

/** Non-economic conditions of the current sheet not covered by an approved request. */
export function pendingNonEconomic(
  sheet: typeof sheetVersions.$inferSelect | null,
  approval: typeof approvalRequests.$inferSelect | null,
  settings: Settings,
): NonEconomicCondition[] {
  if (!sheet) return [];
  const detected = detectConditions(
    {
      paymentTermDays: sheet.paymentTermDays,
      clpWithoutFxPremium: sheet.clpWithoutFxPremium,
      penaltyCapPct: sheet.penaltyCapPct,
      unlimitedLiability: sheet.unlimitedLiability,
    },
    settings,
  );
  const covered =
    approval && approval.status === 'APPROVED' && approval.sheetVersionId === sheet.id
      ? approval.conditions
      : [];
  return detected.filter((c) => !covered.includes(c));
}

/** Moves the opportunity to a stage, writing stage_history and the audit log. */
export async function changeStage(
  tx: DbOrTx,
  opp: OpportunityRow,
  toStage: number,
  actor: Actor,
  opts: { reason?: string | null; derived?: boolean; toStatus?: OpportunityStatus } = {},
): Promise<OpportunityRow> {
  const now = new Date();
  const patch: Partial<typeof opportunities.$inferInsert> = {
    stage: toStage,
    stageEnteredAt: now,
    rowVersion: opp.rowVersion + 1,
    updatedAt: now,
    updatedBy: actor.userId,
  };
  if (opts.toStatus) patch.status = opts.toStatus;
  if (toStage >= 7 && opp.stage < 7) {
    const [acc] = await tx
      .select({ customerType: accounts.customerType })
      .from(accounts)
      .where(eq(accounts.id, opp.accountId));
    patch.wonAt = now;
    patch.customerTypeFrozen = acc?.customerType ?? null;
    patch.forecastCategory = 'COMMIT';
  }
  const [after] = await tx
    .update(opportunities)
    .set(patch)
    .where(eq(opportunities.id, opp.id))
    .returning();
  await tx.insert(stageHistory).values({
    opportunityId: opp.id,
    fromStage: opp.stage,
    toStage,
    fromStatus: opp.status,
    toStatus: opts.toStatus ?? opp.status,
    changedBy: actor.userId,
    reason: opts.reason ?? null,
    derived: opts.derived ?? false,
  });
  await recordAudit(tx, actor, {
    action: 'STAGE_CHANGE',
    category: 'STAGE',
    entityType: 'opportunity',
    entityId: opp.id,
    opportunityId: opp.id,
    accountId: opp.accountId,
    changes: [{ field: 'stage', old: opp.stage, new: toStage }],
    reason: opts.reason ?? (opts.derived ? 'derived from milestones' : null),
  });
  return after!;
}

/** Stages 9–11 are derived from milestones once the opportunity is in delivery (CORE-06). */
export async function recomputeDerivedStage(
  tx: DbOrTx,
  oppId: string,
  actor: Actor,
): Promise<void> {
  const opp = await lockOpportunity(tx, oppId);
  if (opp.stage < 8 || opp.status !== 'OPEN') return;
  const ms = await tx
    .select({ status: milestones.status })
    .from(milestones)
    .where(eq(milestones.opportunityId, oppId));
  if (!ms.length) return;
  const derived = deriveStageFromMilestones(ms.map((m) => m.status as MilestoneStatus));
  if (derived !== opp.stage) await changeStage(tx, opp, derived, actor, { derived: true });
}
