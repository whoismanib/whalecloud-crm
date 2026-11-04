import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { base, frac } from './columns';
import {
  approvalBand,
  approvalStatus,
  approvalStepKind,
  nonEconomicCondition,
  userRole,
} from './enums';
import { users } from './identity';
import { businessCases, opportunities } from './opportunities';
import { sheetVersions } from './pricing';

export const approvalRequests = pgTable(
  'approval_requests',
  {
    ...base(),
    opportunityId: uuid()
      .notNull()
      .references(() => opportunities.id),
    sheetVersionId: uuid()
      .notNull()
      .references(() => sheetVersions.id),
    status: approvalStatus().notNull().default('PENDING'),
    band: approvalBand().notNull(),
    marginBasis: text().notNull(),
    netMargin: frac(),
    contractMargin: frac(),
    minLineMargin: frac(),
    competitiveJustification: text(),
    businessCaseId: uuid().references(() => businessCases.id),
    conditions: nonEconomicCondition()
      .array()
      .notNull()
      .default(sql`'{}'`),
    rulesSnapshot: jsonb().notNull(),
    requestedBy: uuid().references(() => users.id),
    requestedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp({ withTimezone: true }),
    validDays: smallint().notNull().default(60),
    expiresOn: date(),
    invalidatedAt: timestamp({ withTimezone: true }),
    invalidationReason: text(),
    isException: boolean().notNull().default(false),
  },
  (t) => [
    check('approval_requests_band_check', sql`${t.band} <> 'NOT_QUOTABLE'`),
    check('approval_requests_basis_check', sql`${t.marginBasis} IN ('NET_INCOME','CONTRACT')`),
    index('approval_requests_opportunity_id_status_idx').on(t.opportunityId, t.status),
    index('approval_requests_expires_on_idx')
      .on(t.expiresOn)
      .where(sql`${t.status} = 'APPROVED'`),
  ],
);

export const approvalSteps = pgTable(
  'approval_steps',
  {
    ...base(),
    approvalRequestId: uuid()
      .notNull()
      .references(() => approvalRequests.id, { onDelete: 'cascade' }),
    seq: smallint().notNull(),
    kind: approvalStepKind().notNull(),
    condition: nonEconomicCondition(),
    assigneeRole: userRole().notNull(),
    assigneeUserId: uuid().references(() => users.id),
    consultedRoles: userRole()
      .array()
      .notNull()
      .default(sql`'{}'`),
    informedRoles: userRole()
      .array()
      .notNull()
      .default(sql`'{}'`),
    status: approvalStatus().notNull().default('PENDING'),
    dueOn: date(),
    decidedBy: uuid().references(() => users.id),
    onBehalfOfUserId: uuid(),
    decidedAt: timestamp({ withTimezone: true }),
    comment: text(),
    evidenceAttachmentId: uuid(),
  },
  (t) => [
    check(
      'approval_steps_reject_comment_check',
      sql`${t.status} NOT IN ('REJECTED','CHANGES_REQUESTED') OR ${t.comment} IS NOT NULL`,
    ),
    index('approval_steps_assignee_user_id_status_idx').on(t.assigneeUserId, t.status),
    index('approval_steps_assignee_role_status_idx').on(t.assigneeRole, t.status),
    index('approval_steps_request_idx').on(t.approvalRequestId),
  ],
);
