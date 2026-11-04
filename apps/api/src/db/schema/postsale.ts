import { date, index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { base } from './columns';
import { ballIn, ticketPriority, ticketStatus } from './enums';
import { accounts } from './accounts';

/**
 * eDo-like incident tickets (legacy "Incidentes eDo" page, P10-02 monthly review).
 * Loaded manually or by CSV in phase 1; eDo Open API integration is backlog.
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
  },
  (t) => [
    uniqueIndex('tickets_account_number_uq').on(t.accountId, t.number),
    index('tickets_status_idx').on(t.status),
  ],
);
