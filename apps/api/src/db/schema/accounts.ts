import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { base } from './columns';
import {
  activitySource,
  activityType,
  contactRole,
  currencyCode,
  customerType,
  topicState,
  vertical,
} from './enums';
import { billingEntities, citext, countries, users } from './identity';

export const accounts = pgTable(
  'accounts',
  {
    ...base(),
    name: text().notNull(),
    legalName: text(),
    taxId: text(),
    countryCode: char({ length: 2 })
      .notNull()
      .references(() => countries.code),
    vertical: vertical().notNull(),
    customerType: customerType().notNull(),
    defaultBillingEntityId: uuid()
      .notNull()
      .references(() => billingEntities.id),
    currency: currencyCode().notNull(),
    isKeyAccount: boolean().notNull().default(false),
    acceptsSimpleEsign: boolean().notNull().default(false),
    newWorkSuspended: boolean().notNull().default(false),
    suspendedAt: timestamp({ withTimezone: true }),
    suspendedReason: text(),
    ownerId: uuid()
      .notNull()
      .references(() => users.id),
    website: text(),
    notes: text(),
    archivedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index('accounts_lower_name_idx').on(sql`lower(${t.name})`),
    index('accounts_owner_id_idx').on(t.ownerId),
    index('accounts_country_code_vertical_idx').on(t.countryCode, t.vertical),
    uniqueIndex('accounts_country_tax_id_uq')
      .on(t.countryCode, t.taxId)
      .where(sql`${t.taxId} IS NOT NULL`),
  ],
);

export const contacts = pgTable(
  'contacts',
  {
    ...base(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id),
    firstName: text().notNull(),
    lastName: text().notNull(),
    jobTitle: text(),
    email: citext(),
    phone: text(),
    mobile: text(),
    buyingRoles: contactRole()
      .array()
      .notNull()
      .default(sql`'{}'`),
    preferredLanguage: text(),
    consentStatus: text().notNull().default('UNKNOWN'),
    consentAt: timestamp({ withTimezone: true }),
    anonymizedAt: timestamp({ withTimezone: true }),
    notes: text(),
    archivedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index('contacts_account_id_idx').on(t.accountId),
    index('contacts_buying_roles_idx').using('gin', t.buyingRoles),
    index('contacts_email_idx').on(t.email),
    check(
      'contacts_consent_status_check',
      sql`${t.consentStatus} IN ('UNKNOWN','GRANTED','WITHDRAWN')`,
    ),
  ],
);

export const activities = pgTable(
  'activities',
  {
    ...base(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id),
    opportunityId: uuid(),
    type: activityType().notNull(),
    occurredAt: timestamp({ withTimezone: true }).notNull(),
    subject: text().notNull(),
    notes: text(),
    contactIds: uuid()
      .array()
      .notNull()
      .default(sql`'{}'`),
    userIds: uuid()
      .array()
      .notNull()
      .default(sql`'{}'`),
    outcome: text(),
    // ---- mail / calendar sync (ADR 0008) ----
    source: activitySource().notNull().default('MANUAL'),
    /** Idempotency key of synced/imported rows (message id, or owner|topic|kind for digests). */
    externalKey: text(),
    direction: text(),
    /** Messages summarised by the row (1 for a single e-mail or meeting). */
    itemCount: integer().notNull().default(1),
    topicId: uuid().references(() => engagementTopics.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('activities_opportunity_id_occurred_at_idx').on(t.opportunityId, t.occurredAt),
    index('activities_account_id_occurred_at_idx').on(t.accountId, t.occurredAt),
    index('activities_topic_id_idx').on(t.topicId),
    uniqueIndex('activities_source_external_key_uq')
      .on(t.source, t.externalKey)
      .where(sql`external_key IS NOT NULL`),
    check(
      'activities_direction_check',
      sql`${t.direction} IS NULL OR ${t.direction} IN ('IN','OUT')`,
    ),
    check('activities_item_count_check', sql`${t.itemCount} >= 1`),
  ],
);

/**
 * Engagement topics ("temas de seguimiento", ADR 0008): one per legacy taxonomy project or mail
 * matching rule of a mailbox owner. The unit of the legacy "Salud CRM" score.
 */
export const engagementTopics = pgTable(
  'engagement_topics',
  {
    ...base(),
    ownerUserId: uuid()
      .notNull()
      .references(() => users.id),
    source: activitySource().notNull(),
    externalKey: text().notNull(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id),
    opportunityId: uuid(),
    clientLabel: text().notNull(),
    section: text().notNull().default(''),
    name: text().notNull(),
    state: topicState().notNull().default('ACTIVE'),
    stateReason: text(),
    edoRefs: text()
      .array()
      .notNull()
      .default(sql`'{}'`),
    edoLastUpdateAt: timestamp({ withTimezone: true }),
    lastSeenAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex('engagement_topics_owner_key_uq').on(t.ownerUserId, t.source, t.externalKey),
    index('engagement_topics_account_idx').on(t.accountId),
  ],
);

/** Mailbox totals per sync run ("Correos (30d)" card), including mail that matched no topic. */
export const mailSnapshots = pgTable(
  'mail_snapshots',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id),
    source: activitySource().notNull(),
    generatedAt: timestamp({ withTimezone: true }).notNull(),
    windowDays: integer().notNull(),
    inboxCount: integer().notNull(),
    sentCount: integer().notNull(),
    calendarCount: integer().notNull(),
    matchedCount: integer().notNull(),
    meetingsMatched: integer().notNull(),
    upcomingMatched: integer().notNull(),
    unmatchedCount: integer().notNull(),
    unmatchedEvents: integer().notNull(),
    importJobId: uuid(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('mail_snapshots_user_generated_uq').on(t.userId, t.source, t.generatedAt)],
);
