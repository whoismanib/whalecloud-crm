import { sql } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { base, frac, money } from './columns';
import {
  billingEngine,
  contactRole,
  customerType,
  docStatus,
  forecastCategory,
  leadOrigin,
  opportunityStatus,
  qualStatus,
  riskLevel,
  vertical,
} from './enums';
import { accounts, contacts } from './accounts';
import { countries, users } from './identity';

export const opportunities = pgTable(
  'opportunities',
  {
    ...base(),
    code: text().notNull().unique(),
    name: text().notNull(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id),
    ownerId: uuid()
      .notNull()
      .references(() => users.id),
    countryCode: char({ length: 2 })
      .notNull()
      .references(() => countries.code),
    vertical: vertical().notNull(),
    billingEngine: billingEngine().notNull(),
    origin: leadOrigin().notNull(),
    distributorId: uuid(),
    stage: smallint().notNull().default(0),
    status: opportunityStatus().notNull().default('OPEN'),
    stageEnteredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    ...money('amount'),
    expectedCloseDate: date().notNull(),
    decisionDate: date(),
    firstContactDate: date().notNull(),
    registeredLate: boolean().notNull().default(false),
    forecastCategory: forecastCategory(),
    risk: riskLevel(),
    legacyStatus: text(),
    onHold: boolean().notNull().default(false),
    pain: text(),
    sponsorContactId: uuid().references(() => contacts.id),
    decisionCriteria: text(),
    competitors: text()
      .array()
      .notNull()
      .default(sql`'{}'`),
    customerTypeFrozen: customerType(),
    countsAsDigital: boolean().notNull(),
    digitalOverridden: boolean().notNull().default(false),
    isRenewal: boolean().notNull().default(false),
    usesBusinessCase: boolean().notNull().default(false),
    currentPriceRequestId: uuid(),
    currentSheetVersionId: uuid(),
    chinaSheetVersionLabel: text(),
    currentApprovalRequestId: uuid(),
    approvedNetMargin: frac(),
    approvedContractMargin: frac(),
    approvedByUserId: uuid().references(() => users.id),
    approvedAt: timestamp({ withTimezone: true }),
    approvalExpiresOn: date(),
    chinaSystemContractId: text(),
    zmpProjectId: text(),
    wonAt: timestamp({ withTimezone: true }),
    closedAt: timestamp({ withTimezone: true }),
    closeReason: text(),
    winningCompetitor: text(),
    ...money('winningPrice'),
    lastActivityAt: timestamp({ withTimezone: true }),
    archivedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    check('opportunities_stage_check', sql`${t.stage} BETWEEN 0 AND 11`),
    check(
      'opportunities_distributor_check',
      sql`${t.origin} <> 'DISTRIBUTOR' OR ${t.distributorId} IS NOT NULL`,
    ),
    check(
      'opportunities_close_reason_check',
      sql`${t.status} = 'OPEN' OR ${t.closeReason} IS NOT NULL`,
    ),
    index('opportunities_status_stage_idx').on(t.status, t.stage),
    index('opportunities_owner_id_status_idx').on(t.ownerId, t.status),
    index('opportunities_account_id_idx').on(t.accountId),
    index('opportunities_expected_close_date_idx')
      .on(t.expectedCloseDate)
      .where(sql`${t.status} = 'OPEN'`),
    index('opportunities_country_code_idx').on(t.countryCode),
    index('opportunities_billing_engine_idx').on(t.billingEngine),
    index('opportunities_vertical_idx').on(t.vertical),
  ],
);

export const opportunityQualifications = pgTable('opportunity_qualifications', {
  opportunityId: uuid()
    .primaryKey()
    .references(() => opportunities.id, { onDelete: 'cascade' }),
  bantBudget: qualStatus().notNull().default('EMPTY'),
  bantAuthority: qualStatus().notNull().default('EMPTY'),
  bantNeed: qualStatus().notNull().default('EMPTY'),
  bantTimeline: qualStatus().notNull().default('EMPTY'),
  mMetrics: qualStatus().notNull().default('EMPTY'),
  mEconomicBuyer: qualStatus().notNull().default('EMPTY'),
  mDecisionCriteria: qualStatus().notNull().default('EMPTY'),
  mDecisionProcess: qualStatus().notNull().default('EMPTY'),
  mPaperProcess: qualStatus().notNull().default('EMPTY'),
  mIdentifyPain: qualStatus().notNull().default('EMPTY'),
  mChampion: qualStatus().notNull().default('EMPTY'),
  mCompetition: qualStatus().notNull().default('EMPTY'),
  notes: jsonb().notNull().default({}),
  meddpiccScore: numeric({ precision: 4, scale: 3 }),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid(),
});

export const opportunityContacts = pgTable(
  'opportunity_contacts',
  {
    opportunityId: uuid()
      .notNull()
      .references(() => opportunities.id, { onDelete: 'cascade' }),
    contactId: uuid()
      .notNull()
      .references(() => contacts.id),
    roles: contactRole()
      .array()
      .notNull()
      .default(sql`'{}'`),
  },
  (t) => [primaryKey({ columns: [t.opportunityId, t.contactId] })],
);

/** Append-only (trigger forbid_update_delete). */
export const stageHistory = pgTable(
  'stage_history',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    opportunityId: uuid()
      .notNull()
      .references(() => opportunities.id),
    fromStage: smallint(),
    toStage: smallint().notNull(),
    fromStatus: opportunityStatus(),
    toStatus: opportunityStatus().notNull(),
    changedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    changedBy: uuid(),
    reason: text(),
    derived: boolean().notNull().default(false),
  },
  (t) => [index('stage_history_opportunity_id_changed_at_idx').on(t.opportunityId, t.changedAt)],
);

export const opportunityAssignments = pgTable(
  'opportunity_assignments',
  {
    opportunityId: uuid()
      .notNull()
      .references(() => opportunities.id, { onDelete: 'cascade' }),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    reason: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.opportunityId, t.userId, t.reason] })],
);

export const businessCases = pgTable(
  'business_cases',
  {
    ...base(),
    opportunityId: uuid()
      .notNull()
      .references(() => opportunities.id),
    version: integer().notNull(),
    status: docStatus().notNull().default('DRAFT'),
    pain: text(),
    baselineMetric: text(),
    benefit: text(),
    tcoHorizonYears: smallint(),
    ...money('tco'),
    roiPct: numeric({ precision: 9, scale: 4 }),
    paybackMonths: numeric({ precision: 6, scale: 1 }),
    risks: text(),
    strategicValue: text(),
    submittedAt: timestamp({ withTimezone: true }),
    approvedBy: uuid().references(() => users.id),
    approvedAt: timestamp({ withTimezone: true }),
    decisionComment: text(),
    financeConsultedBy: uuid(),
    financeComment: text(),
  },
  (t) => [
    uniqueIndex('business_cases_opportunity_id_version_uq').on(t.opportunityId, t.version),
    check(
      'business_cases_tco_horizon_check',
      sql`${t.tcoHorizonYears} IS NULL OR ${t.tcoHorizonYears} BETWEEN 3 AND 5`,
    ),
  ],
);
