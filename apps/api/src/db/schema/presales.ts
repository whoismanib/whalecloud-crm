import { sql } from 'drizzle-orm';
import { check, date, index, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { base, money } from './columns';
import { complianceAnswer, rfpDecision, rfpResult, rfpType } from './enums';
import { users } from './identity';
import { opportunities } from './opportunities';

// ---------- P3 Preventa RFI/RFP (DATA-MODEL §4.4, QA-004) ----------

export const rfps = pgTable(
  'rfps',
  {
    ...base(),
    opportunityId: uuid()
      .notNull()
      .references(() => opportunities.id),
    type: rfpType().notNull().default('RFP'),
    title: text().notNull(),
    receivedOn: date().notNull(),
    clientDeadline: date().notNull(),
    internalDeadline: date().notNull(),
    documentsUrl: text(),
    notes: text(),
    decision: rfpDecision().notNull().default('PENDING'),
    decisionDueOn: date().notNull(),
    decisionReason: text(),
    decidedOn: date(),
    decidedAt: timestamp({ withTimezone: true }),
    decidedBy: uuid().references(() => users.id),
    cmReviewedBy: uuid().references(() => users.id),
    cmReviewedAt: timestamp({ withTimezone: true }),
    cmReviewComment: text(),
    deliveredOn: date(),
    deliveredAt: timestamp({ withTimezone: true }),
    result: rfpResult().notNull().default('PENDING'),
    winningCompetitor: text(),
    ...money('winningPrice'),
    compliancePct: numeric({ precision: 7, scale: 4 }),
  },
  (t) => [
    index('rfps_opportunity_idx').on(t.opportunityId),
    check('rfps_deadline_chk', sql`${t.clientDeadline} >= ${t.receivedOn}`),
    check(
      'rfps_delivered_reviewed_chk',
      sql`${t.deliveredAt} IS NULL OR ${t.cmReviewedAt} IS NOT NULL`,
    ),
  ],
);

export const rfpRequirements = pgTable(
  'rfp_requirements',
  {
    ...base(),
    rfpId: uuid()
      .notNull()
      .references(() => rfps.id, { onDelete: 'cascade' }),
    ref: text(),
    requirement: text().notNull(),
    answer: complianceAnswer().notNull().default('PENDING'),
    comment: text(),
    assigneeUserId: uuid().references(() => users.id),
    answeredBy: uuid().references(() => users.id),
    answeredAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index('rfp_requirements_rfp_idx').on(t.rfpId),
    index('rfp_requirements_assignee_idx').on(t.assigneeUserId),
  ],
);
