import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { base } from './columns';
import { resourceType, userRole } from './enums';
import { users } from './identity';
import { priceRequests } from './pricing';

/** ADM-04: temporary delegation of approvals (absences); DATA-MODEL §4.1. */
export const approvalDelegations = pgTable(
  'approval_delegations',
  {
    ...base(),
    delegatorUserId: uuid()
      .notNull()
      .references(() => users.id),
    delegateUserId: uuid()
      .notNull()
      .references(() => users.id),
    role: userRole().notNull(),
    startsOn: date().notNull(),
    endsOn: date().notNull(),
    reason: text().notNull(),
    revokedAt: timestamp({ withTimezone: true }),
    revokedBy: uuid().references(() => users.id),
  },
  (t) => [
    index('approval_delegations_delegator_idx').on(t.delegatorUserId, t.startsOn, t.endsOn),
    index('approval_delegations_delegate_idx').on(t.delegateUserId, t.startsOn, t.endsOn),
    check('approval_delegations_range_chk', sql`${t.endsOn} >= ${t.startsOn}`),
  ],
);

/** P5-04: person-month cost estimates assigned by China Sales to R&D / delivery China. */
export const costEstimates = pgTable(
  'cost_estimates',
  {
    ...base(),
    priceRequestId: uuid()
      .notNull()
      .references(() => priceRequests.id),
    area: text().notNull(),
    resourceType: resourceType().notNull(),
    personMonths: numeric({ precision: 8, scale: 2 }),
    mandatory: boolean().notNull().default(true),
    assigneeUserId: uuid()
      .notNull()
      .references(() => users.id),
    signedBy: uuid().references(() => users.id),
    signedAt: timestamp({ withTimezone: true }),
    notes: text(),
  },
  (t) => [
    index('cost_estimates_pr_idx').on(t.priceRequestId),
    index('cost_estimates_assignee_idx').on(t.assigneeUserId),
    check('cost_estimates_pm_chk', sql`${t.personMonths} IS NULL OR ${t.personMonths} >= 0`),
  ],
);
