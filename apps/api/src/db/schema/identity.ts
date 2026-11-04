import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  serial,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  bigserial,
  check,
} from 'drizzle-orm/pg-core';
import { base, frac } from './columns';
import { currencyCode, fxKind, processCode, raciLetter, userRole } from './enums';

export const citext = customType<{ data: string }>({ dataType: () => 'citext' });
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });
export const inet = customType<{ data: string }>({ dataType: () => 'inet' });

export const calendars = pgTable('calendars', {
  id: text().primaryKey(),
  name: text().notNull(),
  timezone: text().notNull(),
  weekendDays: smallint()
    .array()
    .notNull()
    .default(sql`'{0,6}'`),
});

export const holidays = pgTable(
  'holidays',
  {
    calendarId: text()
      .notNull()
      .references(() => calendars.id, { onDelete: 'cascade' }),
    date: date().notNull(),
    name: text().notNull(),
    /** true = extra working day (China make-up weekend). */
    isWorkday: boolean().notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.calendarId, t.date] })],
);

export const users = pgTable(
  'users',
  {
    ...base(),
    email: citext().notNull().unique(),
    fullName: text().notNull(),
    passwordHash: text().notNull(),
    mfaSecretEnc: text(),
    mfaEnabled: boolean().notNull().default(false),
    locale: text().notNull().default('es-CL'),
    timezone: text().notNull().default('America/Santiago'),
    calendarId: text()
      .notNull()
      .default('CL')
      .references(() => calendars.id),
    countryCodes: text()
      .array()
      .notNull()
      .default(sql`'{CL}'`),
    isActive: boolean().notNull().default(true),
    failedLogins: integer().notNull().default(0),
    lockedUntil: timestamp({ withTimezone: true }),
    lastLoginAt: timestamp({ withTimezone: true }),
    deactivatedAt: timestamp({ withTimezone: true }),
    joinedOn: date(),
  },
  (t) => [check('users_locale_check', sql`${t.locale} IN ('es-CL','zh-CN','en')`)],
);

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: userRole().notNull(),
    grantedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    grantedBy: uuid(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] })],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: bytea().notNull().unique(),
    csrfToken: text().notNull(),
    mfaVerified: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ip: inet(),
    userAgent: text(),
  },
  (t) => [
    index('sessions_user_id_idx').on(t.userId),
    index('sessions_expires_at_idx').on(t.expiresAt),
  ],
);

export const raciVersions = pgTable(
  'raci_versions',
  {
    id: serial().primaryKey(),
    version: integer().notNull().unique(),
    isActive: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid(),
    comment: text(),
  },
  (t) => [
    uniqueIndex('raci_versions_active_uq')
      .on(t.isActive)
      .where(sql`${t.isActive}`),
  ],
);

export const raciEntries = pgTable(
  'raci_entries',
  {
    raciVersionId: integer()
      .notNull()
      .references(() => raciVersions.id, { onDelete: 'cascade' }),
    process: processCode().notNull(),
    role: userRole().notNull(),
    letters: raciLetter()
      .array()
      .notNull()
      .default(sql`'{}'`),
  },
  (t) => [primaryKey({ columns: [t.raciVersionId, t.process, t.role] })],
);

export const settings = pgTable('settings', {
  key: text().primaryKey(),
  value: jsonb().notNull(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid(),
});

export const settingsHistory = pgTable('settings_history', {
  id: bigserial({ mode: 'number' }).primaryKey(),
  key: text().notNull(),
  value: jsonb().notNull(),
  changedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  changedBy: uuid(),
});

export const countries = pgTable('countries', {
  code: char({ length: 2 }).primaryKey(),
  nameEs: text().notNull(),
  nameEn: text().notNull(),
  nameZh: text().notNull(),
  defaultCurrency: currencyCode().notNull(),
  calendarId: text()
    .notNull()
    .references(() => calendars.id),
  vatPct: frac(),
  active: boolean().notNull().default(true),
});

export const billingEntities = pgTable('billing_entities', {
  ...base(),
  code: text().notNull().unique(),
  legalName: text().notNull(),
  countryCode: char({ length: 2 })
    .notNull()
    .references(() => countries.code),
  taxId: text(),
  vatPct: frac().notNull(),
  withholdingPct: frac().notNull(),
  currency: currencyCode().notNull(),
  isImporter: boolean().notNull().default(false),
  active: boolean().notNull().default(true),
});

export const fxRates = pgTable(
  'fx_rates',
  {
    id: uuid().primaryKey().defaultRandom(),
    month: date().notNull(),
    currency: currencyCode().notNull(),
    unitsPerUsd: numeric({ precision: 18, scale: 6 }).notNull(),
    kind: fxKind().notNull().default('ACTUAL'),
    source: text(),
    loadedBy: uuid(),
    loadedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('fx_rates_month_currency_kind_uq').on(t.month, t.currency, t.kind),
    check('fx_rates_month_first_day', sql`extract(day from ${t.month}) = 1`),
    check('fx_rates_positive', sql`${t.unitsPerUsd} > 0`),
  ],
);

export const targets = pgTable(
  'targets',
  {
    ...base(),
    kpiCode: text().notNull(),
    year: smallint().notNull(),
    segment: text().notNull().default('TOTAL'),
    value: numeric({ precision: 18, scale: 2 }),
    unit: text().notNull(),
  },
  (t) => [uniqueIndex('targets_kpi_year_segment_uq').on(t.kpiCode, t.year, t.segment)],
);
