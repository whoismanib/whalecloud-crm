import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { base } from './columns';
import { activityType, contactRole, currencyCode, customerType, vertical } from './enums';
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
  },
  (t) => [
    index('activities_opportunity_id_occurred_at_idx').on(t.opportunityId, t.occurredAt),
    index('activities_account_id_occurred_at_idx').on(t.accountId, t.occurredAt),
  ],
);
