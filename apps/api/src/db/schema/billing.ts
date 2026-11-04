import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { base, dec, frac, money, pct } from './columns';
import {
  actionStatus,
  billingEngine,
  collectionStep,
  evidenceType,
  invoiceStatus,
  milestoneStatus,
  milestoneTrigger,
  signatureType,
  userRole,
} from './enums';
import { accounts } from './accounts';
import { attachments, contracts } from './contracts';
import { billingEntities, users } from './identity';
import { opportunities } from './opportunities';

export const milestones = pgTable(
  'milestones',
  {
    ...base(),
    contractId: uuid()
      .notNull()
      .references(() => contracts.id),
    opportunityId: uuid()
      .notNull()
      .references(() => opportunities.id),
    seq: smallint().notNull(),
    name: text().notNull(),
    pct: pct(),
    ...money('amount'),
    trigger: milestoneTrigger(),
    billingEngine: billingEngine().notNull(),
    acceptanceCriteria: text(),
    plannedDate: date(),
    readyAt: timestamp({ withTimezone: true }),
    acDueOn: date(),
    acceptanceEmailAt: timestamp({ withTimezone: true }),
    acSignedAt: date(),
    receptionAt: date(),
    recognizedOn: date(),
    sentToFinanceAt: timestamp({ withTimezone: true }),
    invoiceDueOn: date(),
    periodStart: date(),
    periodEnd: date(),
    status: milestoneStatus().notNull().default('PLANNED'),
    isFinal: boolean().notNull().default(false),
  },
  (t) => [
    uniqueIndex('milestones_contract_seq_uq').on(t.contractId, t.seq),
    index('milestones_opportunity_id_idx').on(t.opportunityId),
    index('milestones_status_idx').on(t.status),
  ],
);

export const milestoneEvidence = pgTable(
  'milestone_evidence',
  {
    ...base(),
    milestoneId: uuid()
      .notNull()
      .references(() => milestones.id, { onDelete: 'cascade' }),
    evidenceType: evidenceType().notNull(),
    attachmentId: uuid()
      .notNull()
      .references(() => attachments.id),
    receivedOn: date(),
    signatureType: signatureType(),
    notes: text(),
  },
  (t) => [index('milestone_evidence_milestone_type_idx').on(t.milestoneId, t.evidenceType)],
);

export const milestoneBillingLines = pgTable(
  'milestone_billing_lines',
  {
    ...base(),
    milestoneId: uuid()
      .notNull()
      .references(() => milestones.id, { onDelete: 'cascade' }),
    lineNo: smallint().notNull(),
    billingEntityId: uuid()
      .notNull()
      .references(() => billingEntities.id),
    description: text(),
    ...money('amount'),
    vatPct: frac(),
    withholdingPct: frac(),
  },
  (t) => [
    check('milestone_billing_lines_line_no', sql`${t.lineNo} BETWEEN 1 AND 4`),
    uniqueIndex('milestone_billing_lines_entity_uq').on(t.milestoneId, t.billingEntityId),
  ],
);

export const invoices = pgTable(
  'invoices',
  {
    ...base(),
    billingLineId: uuid()
      .notNull()
      .references(() => milestoneBillingLines.id),
    milestoneId: uuid()
      .notNull()
      .references(() => milestones.id),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id),
    billingEntityId: uuid()
      .notNull()
      .references(() => billingEntities.id),
    number: text().notNull(),
    issuedOn: date().notNull(),
    ...money('amount'),
    paymentTermDays: smallint(),
    dueOn: date().notNull(),
    balance: dec().notNull(),
    status: invoiceStatus().notNull().default('ISSUED'),
    attachmentId: uuid().references(() => attachments.id),
  },
  (t) => [
    uniqueIndex('invoices_entity_number_uq').on(t.billingEntityId, t.number),
    index('invoices_due_on_idx')
      .on(t.dueOn)
      .where(sql`${t.balance} > 0`),
    index('invoices_account_id_idx').on(t.accountId),
  ],
);

export const payments = pgTable(
  'payments',
  {
    ...base(),
    invoiceId: uuid()
      .notNull()
      .references(() => invoices.id),
    paidOn: date().notNull(),
    ...money('amount'),
    reference: text(),
  },
  (t) => [
    check('payments_amount_positive', sql`${t.amount} > 0`),
    index('payments_invoice_id_idx').on(t.invoiceId),
    index('payments_paid_on_idx').on(t.paidOn),
  ],
);

export const collectionActions = pgTable(
  'collection_actions',
  {
    ...base(),
    invoiceId: uuid()
      .notNull()
      .references(() => invoices.id),
    step: collectionStep().notNull(),
    scheduledOn: date().notNull(),
    responsibleRole: userRole().notNull(),
    assigneeUserId: uuid().references(() => users.id),
    notifiedRoles: userRole()
      .array()
      .notNull()
      .default(sql`'{}'`),
    status: actionStatus().notNull().default('PENDING'),
    doneAt: timestamp({ withTimezone: true }),
    doneBy: uuid(),
    outcome: text(),
    jobKey: text().notNull().unique(),
  },
  (t) => [index('collection_actions_status_scheduled_on_idx').on(t.status, t.scheduledOn)],
);
