import { sql } from 'drizzle-orm';
import {
  date,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { base } from './columns';
import { ballIn, ticketPriority, ticketStatus } from './enums';
import { accounts } from './accounts';

/**
 * eDo-like incident tickets (legacy "Incidentes eDo" page, P10-02 monthly review).
 * Typed in the CRM or imported from the legacy eDo file (Admin → Importar → Incidentes eDo);
 * direct eDo sync is ADR 0007.
 */
export const tickets = pgTable(
  'tickets',
  {
    ...base(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id),
    number: text().notNull(),
    title: text().notNull(),
    priority: ticketPriority().notNull(),
    status: ticketStatus().notNull().default('OPEN'),
    /** "Pelota en": who must act next. */
    ballIn: ballIn().notNull().default('WHALE'),
    orgHolder: text(),
    ownerName: text(),
    slaDueOn: date(),
    openedOn: date().notNull(),
    lastUpdateAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    closedOn: date(),
    notes: text(),
    /** Source system of an imported ticket ('EDO'); null for tickets typed in the CRM. */
    externalSource: text(),
    /** Stable id in the source (eDo `issueId`). eDo reuses ticket numbers, so this is the key. */
    externalId: text(),
    externalUrl: text(),
    /** Normalized eDo row (`EdoRecord`) used for the legacy incident KPIs; null for manual tickets. */
    edo: jsonb(),
  },
  (t) => [
    // Manual tickets: one number per account. Imported ones are keyed by source + external id.
    uniqueIndex('tickets_account_number_uq')
      .on(t.accountId, t.number)
      .where(sql`${t.externalId} IS NULL`),
    uniqueIndex('tickets_external_uq').on(t.externalSource, t.externalId),
    index('tickets_account_number_idx').on(t.accountId, t.number),
    index('tickets_status_idx').on(t.status),
  ],
);
