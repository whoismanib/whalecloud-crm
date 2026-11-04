import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
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
import { base, money } from './columns';
import {
  billingEngine,
  contractStatus,
  contractType,
  docKind,
  recognitionMode,
  signingModel,
} from './enums';
import { accounts } from './accounts';
import { billingEntities } from './identity';
import { opportunities } from './opportunities';

/**
 * Repository entries with the standard name PAÍS_CLIENTE_TIPO_NÚMERO_VERSIÓN_FECHA (CORE-07).
 * Phase 1 stores links to the shared repository (`is_external_link`); binary upload is phase 2.
 */
export const attachments = pgTable(
  'attachments',
  {
    ...base(),
    storageDriver: text().notNull().default('link'),
    storageKey: text().unique(),
    isExternalLink: boolean().notNull().default(true),
    externalUrl: text(),
    originalName: text(),
    standardName: text().notNull(),
    nameCountry: char({ length: 2 }),
    nameClient: text(),
    docKind: docKind(),
    docNumber: text(),
    versionLabel: text(),
    docDate: date(),
    mimeType: text(),
    sizeBytes: bigint({ mode: 'number' }),
    entityType: text(),
    entityId: uuid(),
    accountId: uuid().references(() => accounts.id),
    opportunityId: uuid().references(() => opportunities.id),
    contractId: uuid(),
  },
  (t) => [
    check(
      'attachments_external_url_check',
      sql`NOT ${t.isExternalLink} OR ${t.externalUrl} ~ '^https://'`,
    ),
    index('attachments_account_id_doc_kind_idx').on(t.accountId, t.docKind),
    index('attachments_contract_id_idx').on(t.contractId),
    index('attachments_opportunity_id_idx').on(t.opportunityId),
    index('attachments_entity_idx').on(t.entityType, t.entityId),
    uniqueIndex('attachments_standard_name_uq')
      .on(t.standardName)
      .where(sql`NOT ${t.isExternalLink}`),
  ],
);

export const contracts = pgTable(
  'contracts',
  {
    ...base(),
    accountId: uuid()
      .notNull()
      .references(() => accounts.id),
    opportunityId: uuid().references(() => opportunities.id),
    parentContractId: uuid(),
    type: contractType().notNull(),
    number: text(),
    title: text().notNull(),
    status: contractStatus().notNull().default('DRAFT'),
    signingModel: signingModel(),
    billingEntityId: uuid()
      .notNull()
      .references(() => billingEntities.id),
    secondaryBillingEntityId: uuid().references(() => billingEntities.id),
    billingEngine: billingEngine(),
    signedOn: date(),
    startDate: date(),
    endDate: date(),
    renewable: boolean().notNull().default(false),
    autoRenew: boolean().notNull().default(false),
    ...money('amount'),
    countsForSs: boolean().notNull(),
    recognitionMode: recognitionMode().notNull().default('PER_MILESTONE'),
    repositoryUrl: text(),
    signedAttachmentId: uuid().references(() => attachments.id),
    repositoryUploadedAt: timestamp({ withTimezone: true }),
    chinaSystemId: text(),
    renewalNoticeDays: smallint(),
  },
  (t) => [
    check('contracts_nda_ss_check', sql`${t.type} <> 'NDA' OR NOT ${t.countsForSs}`),
    check(
      'contracts_repository_check',
      sql`${t.status} NOT IN ('SIGNED','ACTIVE') OR ${t.repositoryUrl} IS NOT NULL`,
    ),
    index('contracts_account_id_idx').on(t.accountId),
    index('contracts_opportunity_id_idx').on(t.opportunityId),
    index('contracts_type_signed_on_idx').on(t.type, t.signedOn),
    uniqueIndex('contracts_account_type_number_uq')
      .on(t.accountId, t.type, t.number)
      .where(sql`${t.number} IS NOT NULL`),
  ],
);

/** P9 hand-off (minimal in phase 1: needed by the 7→8 gate). */
export const handoffs = pgTable('handoffs', {
  ...base(),
  opportunityId: uuid()
    .notNull()
    .unique()
    .references(() => opportunities.id),
  contractId: uuid().references(() => contracts.id),
  dueOn: date(),
  meetingAt: timestamp({ withTimezone: true }),
  attendeeUserIds: uuid()
    .array()
    .notNull()
    .default(sql`'{}'`),
  externalAttendees: text(),
  acceptanceCriteria: text(),
  zmpProjectId: text(),
  plannedStart: date(),
  actualStart: date(),
  notes: text(),
});
