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
  accountReviewKind,
  capacityAlert,
  checklistStatus,
  complianceSection,
  crStatus,
  currencyCode,
  docStatus,
  forecastCategory,
  importKind,
  onboardingItem,
  opportunityStatus,
  registrationStatus,
  renewalStatus,
  vertical,
  yesNoNa,
} from './enums';
import { accounts } from './accounts';
import { contracts } from './contracts';
import { citext, countries, users } from './identity';
import { opportunities } from './opportunities';

// ---------- P10 accounts & renewals ----------

export const accountPlans = pgTable(
  'account_plans',
  {
    ...base(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id),
    year: smallint().notNull(),
    status: docStatus().notNull().default('DRAFT'),
    objectives: text(),
    growthOpportunities: text(),
    contactMap: jsonb().notNull().default([]),
    risks: text(),
    ...money('target'),
    approvedBy: uuid().references(() => users.id),
    approvedAt: timestamp({ withTimezone: true }),
  },
  (t) => [uniqueIndex('account_plans_account_year_uq').on(t.accountId, t.year)],
);

export const accountReviews = pgTable(
  'account_reviews',
  {
    ...base(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id),
    kind: accountReviewKind().notNull(),
    periodStart: date().notNull(),
    heldOn: date().notNull(),
    findings: text().notNull(),
    actions: text(),
    edoTicketStats: jsonb(),
  },
  (t) => [uniqueIndex('account_reviews_uq').on(t.accountId, t.kind, t.periodStart)],
);

export const renewals = pgTable(
  'renewals',
  {
    ...base(),
    contractId: uuid()
      .notNull()
      .references(() => contracts.id),
    endDate: date().notNull(),
    createOn: date().notNull(),
    quoteBy: date().notNull(),
    renewalOpportunityId: uuid().references(() => opportunities.id),
    status: renewalStatus().notNull().default('SCHEDULED'),
    quotedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex('renewals_contract_end_uq').on(t.contractId, t.endDate),
    index('renewals_quote_by_idx').on(t.quoteBy),
  ],
);

// ---------- P11 change requests ----------

export const rateCards = pgTable(
  'rate_cards',
  {
    ...base(),
    accountId: uuid().references(() => accounts.id),
    contractId: uuid().references(() => contracts.id),
    profile: text().notNull(),
    rate: numeric({ precision: 18, scale: 2 }).notNull(),
    currency: currencyCode().notNull(),
    unit: text().notNull().default('HOUR'),
    validFrom: date().notNull(),
    validTo: date(),
  },
  (t) => [index('rate_cards_contract_profile_idx').on(t.contractId, t.profile, t.validFrom)],
);

export const changeRequests = pgTable(
  'change_requests',
  {
    ...base(),
    code: text().notNull().unique(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id),
    parentContractId: uuid()
      .notNull()
      .references(() => contracts.id),
    opportunityId: uuid().references(() => opportunities.id),
    title: text().notNull(),
    description: text(),
    status: crStatus().notNull().default('DRAFT'),
    ...money('amount'),
    poContractId: uuid().references(() => contracts.id),
    poReceivedOn: date(),
    workStartedOn: date(),
    receptionOn: date(),
    cmException: boolean().notNull().default(false),
    exceptionReason: text(),
    exceptionExpiresOn: date(),
    exceptionBy: uuid().references(() => users.id),
  },
  (t) => [
    check(
      'change_requests_exception_check',
      sql`NOT ${t.cmException} OR (${t.exceptionReason} IS NOT NULL AND ${t.exceptionExpiresOn} IS NOT NULL)`,
    ),
  ],
);

export const changeRequestLines = pgTable('change_request_lines', {
  id: uuid().primaryKey().defaultRandom(),
  changeRequestId: uuid()
    .notNull()
    .references(() => changeRequests.id, { onDelete: 'cascade' }),
  profile: text().notNull(),
  hours: numeric({ precision: 8, scale: 2 }).notNull(),
  rate: numeric({ precision: 18, scale: 2 }).notNull(),
  amount: numeric({ precision: 18, scale: 2 }).notNull(),
  rateCardId: uuid().references(() => rateCards.id),
});

// ---------- P12 forecast (immutable snapshots) ----------

export const forecastSnapshots = pgTable(
  'forecast_snapshots',
  {
    id: uuid().primaryKey().defaultRandom(),
    isoYear: smallint().notNull(),
    isoWeek: smallint().notNull(),
    countryCode: char({ length: 2 }).notNull(),
    takenOn: date().notNull(),
    takenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    takenBy: uuid(),
    totals: jsonb().notNull(),
    kpis: jsonb().notNull().default([]),
  },
  (t) => [uniqueIndex('forecast_snapshots_week_uq').on(t.isoYear, t.isoWeek, t.countryCode)],
);

export const forecastSnapshotItems = pgTable(
  'forecast_snapshot_items',
  {
    snapshotId: uuid()
      .notNull()
      .references(() => forecastSnapshots.id),
    opportunityId: uuid().notNull(),
    name: text().notNull(),
    accountName: text().notNull(),
    ownerId: uuid(),
    stage: smallint().notNull(),
    status: opportunityStatus().notNull(),
    forecastCategory: forecastCategory(),
    customerType: text(),
    amountCny: numeric({ precision: 18, scale: 2 }),
    amountUsd: numeric({ precision: 18, scale: 2 }),
    expectedCloseDate: date().notNull(),
    probability: numeric({ precision: 5, scale: 4 }),
  },
  (t) => [primaryKey({ columns: [t.snapshotId, t.opportunityId] })],
);

// ---------- P13 distributors ----------

export const distributors = pgTable('distributors', {
  ...base(),
  name: text().notNull(),
  taxId: text(),
  countryCode: char({ length: 2 })
    .notNull()
    .references(() => countries.code),
  contactName: text(),
  contactEmail: citext(),
  status: text().notNull().default('PROSPECT'),
  archivedAt: timestamp({ withTimezone: true }),
});

export const distributorAgreements = pgTable('distributor_agreements', {
  ...base(),
  distributorId: uuid()
    .notNull()
    .references(() => distributors.id),
  territories: text()
    .array()
    .notNull()
    .default(sql`'{}'`),
  verticals: vertical()
    .array()
    .notNull()
    .default(sql`'{}'`),
  products: text(),
  marginPct: frac(),
  startsOn: date(),
  endsOn: date(),
  status: text().notNull().default('ACTIVE'),
});

export const dealRegistrations = pgTable('deal_registrations', {
  ...base(),
  distributorId: uuid()
    .notNull()
    .references(() => distributors.id),
  accountId: uuid()
    .notNull()
    .references(() => accounts.id),
  opportunityId: uuid().references(() => opportunities.id),
  registeredOn: date().notNull(),
  status: registrationStatus().notNull().default('SUBMITTED'),
  conflictingOpportunityIds: uuid()
    .array()
    .notNull()
    .default(sql`'{}'`),
  decidedBy: uuid().references(() => users.id),
  decidedAt: timestamp({ withTimezone: true }),
  decisionReason: text(),
  notes: text(),
  expiresOn: date(),
});

export const distributorTrainings = pgTable('distributor_trainings', {
  ...base(),
  distributorId: uuid()
    .notNull()
    .references(() => distributors.id),
  kind: text().notNull(),
  heldOn: date().notNull(),
  product: text(),
  attendees: text(),
  notes: text(),
});

// ---------- P14 compliance ----------

export const complianceChecklists = pgTable(
  'compliance_checklists',
  {
    ...base(),
    opportunityId: uuid()
      .notNull()
      .references(() => opportunities.id),
    version: integer().notNull(),
    status: checklistStatus().notNull().default('DRAFT'),
    requiredSections: complianceSection().array().notNull(),
    reviewedBy: uuid().references(() => users.id),
    reviewedAt: timestamp({ withTimezone: true }),
    reviewComment: text(),
    approvedBy: uuid().references(() => users.id),
    approvedAt: timestamp({ withTimezone: true }),
  },
  (t) => [uniqueIndex('compliance_checklists_opp_version_uq').on(t.opportunityId, t.version)],
);

export const complianceItems = pgTable(
  'compliance_items',
  {
    id: uuid().primaryKey().defaultRandom(),
    checklistId: uuid()
      .notNull()
      .references(() => complianceChecklists.id, { onDelete: 'cascade' }),
    section: complianceSection().notNull(),
    itemCode: text().notNull(),
    answer: yesNoNa(),
    required: boolean().notNull(),
    notes: text(),
  },
  (t) => [uniqueIndex('compliance_items_uq').on(t.checklistId, t.itemCode)],
);

// ---------- P15 onboarding ----------

export const onboardingKits = pgTable('onboarding_kits', {
  countryCode: char({ length: 2 })
    .primaryKey()
    .references(() => countries.code),
  items: onboardingItem().array().notNull(),
  productiveDays: smallint().notNull().default(30),
  notes: text(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

export const onboardingChecklists = pgTable('onboarding_checklists', {
  ...base(),
  userId: uuid()
    .notNull()
    .unique()
    .references(() => users.id),
  countryCode: char({ length: 2 }).notNull(),
  startDate: date().notNull(),
  productiveTargetOn: date().notNull(),
  productiveAt: date(),
});

export const onboardingItems = pgTable(
  'onboarding_items',
  {
    checklistId: uuid()
      .notNull()
      .references(() => onboardingChecklists.id, { onDelete: 'cascade' }),
    item: onboardingItem().notNull(),
    doneAt: timestamp({ withTimezone: true }),
    doneBy: uuid(),
    notes: text(),
  },
  (t) => [primaryKey({ columns: [t.checklistId, t.item] })],
);

// ---------- P16 resident capacity ----------

export const residentPos = pgTable('resident_pos', {
  ...base(),
  contractId: uuid()
    .notNull()
    .unique()
    .references(() => contracts.id),
  accountId: uuid()
    .notNull()
    .references(() => accounts.id),
  poNumber: text().notNull().unique(),
  totalHours: numeric({ precision: 10, scale: 2 }).notNull(),
  validFrom: date(),
  validTo: date(),
  consumedHours: numeric({ precision: 10, scale: 2 }).notNull().default('0'),
  alertLevel: capacityAlert().notNull().default('NONE'),
});

export const hoursImports = pgTable('hours_imports', {
  ...base(),
  month: date().notNull(),
  rowsOk: integer().notNull().default(0),
  rowsError: integer().notNull().default(0),
  report: jsonb().notNull().default([]),
});

export const hoursEntries = pgTable(
  'hours_entries',
  {
    id: uuid().primaryKey().defaultRandom(),
    importId: uuid()
      .notNull()
      .references(() => hoursImports.id),
    month: date().notNull(),
    poId: uuid().references(() => residentPos.id),
    poNumberRaw: text().notNull(),
    residentName: text().notNull(),
    hours: numeric({ precision: 8, scale: 2 }).notNull(),
    excessHours: numeric({ precision: 8, scale: 2 }).notNull().default('0'),
    withoutPo: boolean().notNull().default(false),
  },
  (t) => [uniqueIndex('hours_entries_uq').on(t.month, t.poNumberRaw, t.residentName)],
);

// ---------- transversal: notifications and imports ----------

export const notifications = pgTable(
  'notifications',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    type: text().notNull(),
    titleKey: text().notNull(),
    params: jsonb().notNull().default({}),
    entityType: text(),
    entityId: text(),
    link: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp({ withTimezone: true }),
    emailedAt: timestamp({ withTimezone: true }),
    dedupeKey: text().notNull(),
  },
  (t) => [
    uniqueIndex('notifications_user_dedupe_uq').on(t.userId, t.dedupeKey),
    index('notifications_user_read_idx').on(t.userId, t.readAt),
  ],
);

export const importJobs = pgTable('import_jobs', {
  ...base(),
  kind: importKind().notNull(),
  dryRun: boolean().notNull().default(false),
  rowsTotal: integer().notNull().default(0),
  rowsOk: integer().notNull().default(0),
  rowsError: integer().notNull().default(0),
  report: jsonb().notNull().default([]),
});
