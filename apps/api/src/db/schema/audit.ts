import { sql } from 'drizzle-orm';
import { bigserial, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { auditAction, auditCategory, userRole } from './enums';
import { bytea, inet } from './identity';

/**
 * Immutable audit log (ADM-10). Append-only via triggers + REVOKE; each row chained with
 * sha256(prev_hash ‖ canonical row) computed by trigger `audit_log_hash` (migration 0001).
 * No FKs on purpose.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial({ mode: 'number' }).primaryKey(),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    actorUserId: uuid(),
    actorRoles: userRole()
      .array()
      .notNull()
      .default(sql`'{}'`),
    onBehalfOfUserId: uuid(),
    action: auditAction().notNull(),
    category: auditCategory().notNull(),
    entityType: text().notNull(),
    entityId: text().notNull(),
    opportunityId: uuid(),
    accountId: uuid(),
    changes: jsonb().notNull().default([]),
    reason: text(),
    requestId: text(),
    ip: inet(),
    userAgent: text(),
    prevHash: bytea(),
    hash: bytea().notNull(),
  },
  (t) => [
    index('audit_log_entity_idx').on(t.entityType, t.entityId, t.occurredAt),
    index('audit_log_opportunity_idx').on(t.opportunityId, t.occurredAt),
    index('audit_log_actor_idx').on(t.actorUserId, t.occurredAt),
    index('audit_log_category_idx').on(t.category, t.occurredAt),
  ],
);
