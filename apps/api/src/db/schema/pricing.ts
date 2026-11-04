import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { base, dec, frac, money, pct } from './columns';
import {
  approvalBand,
  billingEngine,
  capexOpex,
  competitionType,
  currencyCode,
  lineItemType,
  milestoneSource,
  milestoneTrigger,
  priceRequestStatus,
  priceRequestType,
  relationshipType,
  signingModel,
  userRole,
} from './enums';
import { accounts } from './accounts';
import { users } from './identity';
import { opportunities } from './opportunities';

/** P5: local A1 form + 4 extra data (DATA-MODEL §4.6). */
export const priceRequests = pgTable(
  'price_requests',
  {
    ...base(),
    opportunityId: uuid()
      .notNull()
      .references(() => opportunities.id),
    type: priceRequestType().notNull(),
    status: priceRequestStatus().notNull().default('DRAFT'),
    // A1
    countryCode: char({ length: 2 }),
    accountId: uuid().references(() => accounts.id),
    relationshipType: relationshipType(),
    competitionType: competitionType(),
    salesOwnerId: uuid().references(() => users.id),
    solutionOwnerName: text(),
    solutionOwnerId: uuid(),
    deliveryOwnerName: text(),
    deliveryOwnerId: uuid(),
    projectStageLabel: text(),
    projectLevel: text(),
    ...money('budget'),
    signingModel: signingModel(),
    currency: currencyCode(),
    warrantyMonths: smallint(),
    summary: text(),
    strategy: text(),
    mainCompetitor: text(),
    risks: text(),
    // Extra 1–4
    scopeSummary: text(),
    assumptions: text(),
    exclusions: text(),
    brdAttachmentId: uuid(),
    billingEngine: billingEngine(),
    ...money('targetPrice'),
    targetCompetitor: text(),
    // SLA / status
    submittedAt: timestamp({ withTimezone: true }),
    slaDays: smallint(),
    slaDueOn: date(),
    slaPausedBusinessDays: numeric({ precision: 6, scale: 1 }).notNull().default('0'),
    sheetApprovedAt: timestamp({ withTimezone: true }),
    versionsCount: smallint().notNull().default(0),
    currentHolderRole: userRole(),
  },
  (t) => [
    index('price_requests_opportunity_id_idx').on(t.opportunityId),
    index('price_requests_status_sla_due_on_idx').on(t.status, t.slaDueOn),
    check(
      'price_requests_submit_check',
      sql`${t.status} = 'DRAFT' OR ${t.status} = 'CANCELLED' OR (${t.scopeSummary} IS NOT NULL AND ${t.billingEngine} IS NOT NULL AND ${t.targetPrice} IS NOT NULL)`,
    ),
  ],
);

export const priceRequestExpectedMilestones = pgTable(
  'price_request_expected_milestones',
  {
    id: uuid().primaryKey().defaultRandom(),
    priceRequestId: uuid()
      .notNull()
      .references(() => priceRequests.id, { onDelete: 'cascade' }),
    seq: smallint().notNull(),
    pct: pct().notNull(),
    trigger: milestoneTrigger().notNull(),
    triggerText: text(),
  },
  (t) => [
    uniqueIndex('price_request_expected_milestones_seq_uq').on(t.priceRequestId, t.seq),
    check('price_request_expected_milestones_pct', sql`${t.pct} > 0 AND ${t.pct} <= 100`),
  ],
);

/** Version of China's Project Commercial Info Sheet (outputs per line item). */
export const sheetVersions = pgTable(
  'sheet_versions',
  {
    ...base(),
    priceRequestId: uuid()
      .notNull()
      .references(() => priceRequests.id),
    opportunityId: uuid()
      .notNull()
      .references(() => opportunities.id),
    versionLabel: text().notNull(),
    versionSeq: integer().notNull(),
    isCurrent: boolean().notNull().default(true),
    fileAttachmentId: uuid(),
    currency: currencyCode().notNull(),
    totalPriceExTax: dec(),
    totalCost: dec(),
    totalNetIncome: dec(),
    totalCommercialCosts: dec(),
    netMargin: frac(),
    contractMargin: frac(),
    minLineNetMargin: frac(),
    proposedBand: approvalBand(),
    offerValidityDays: smallint().notNull().default(30),
    paymentTermDays: smallint(),
    clpWithoutFxPremium: boolean().notNull().default(false),
    penaltyCapPct: frac(),
    unlimitedLiability: boolean().notNull().default(false),
    tcEntities: text(),
    fxParams: jsonb(),
    notes: text(),
  },
  (t) => [
    uniqueIndex('sheet_versions_seq_uq').on(t.priceRequestId, t.versionSeq),
    uniqueIndex('sheet_versions_current_uq')
      .on(t.priceRequestId)
      .where(sql`${t.isCurrent}`),
  ],
);

export const sheetLineItems = pgTable(
  'sheet_line_items',
  {
    ...base(),
    sheetVersionId: uuid()
      .notNull()
      .references(() => sheetVersions.id, { onDelete: 'cascade' }),
    lineNo: smallint().notNull(),
    block: text(),
    itemType: lineItemType().notNull(),
    capexOpex: capexOpex().notNull(),
    description: text(),
    quantity: numeric({ precision: 12, scale: 2 }).notNull().default('1'),
    cost: dec().notNull(),
    targetMargin: frac().notNull(),
    priceExTax: dec().notNull(),
    netIncome: dec().notNull(),
    commercialCosts: dec().notNull().default('0'),
    netMargin: frac(),
    contractMargin: frac(),
    band: approvalBand(),
    supportYears: smallint(),
  },
  (t) => [
    uniqueIndex('sheet_line_items_line_no_uq').on(t.sheetVersionId, t.lineNo),
    check('sheet_line_items_cost_check', sql`${t.cost} >= 0`),
  ],
);

export const sheetMilestones = pgTable(
  'sheet_milestones',
  {
    id: uuid().primaryKey().defaultRandom(),
    sheetVersionId: uuid()
      .notNull()
      .references(() => sheetVersions.id, { onDelete: 'cascade' }),
    source: milestoneSource().notNull(),
    seq: smallint().notNull(),
    pct: pct().notNull(),
    trigger: milestoneTrigger().notNull(),
    triggerText: text(),
    expectedQuarter: text(),
  },
  (t) => [uniqueIndex('sheet_milestones_uq').on(t.sheetVersionId, t.source, t.seq)],
);
