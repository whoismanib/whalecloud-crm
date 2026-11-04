import type { AuditAction, AuditCategory, UserRole } from '@wcrm/shared';
import { sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';

export interface Actor {
  userId: string | null;
  roles: UserRole[];
  requestId?: string;
  ip?: string;
  userAgent?: string;
  onBehalfOfUserId?: string | null;
}

export interface FieldChange {
  field: string;
  old: unknown;
  new: unknown;
}

export interface AuditEvent {
  action: AuditAction;
  category: AuditCategory;
  entityType: string;
  entityId: string;
  opportunityId?: string | null;
  accountId?: string | null;
  changes?: FieldChange[];
  reason?: string | null;
}

/** Contact fields registered as "[PII]" so anonymisation never touches the log (ARCHITECTURE §7). */
const PII_FIELDS = new Set(['firstName', 'lastName', 'email', 'phone', 'mobile', 'notes']);

/** Field-level diff limited to `fields`; PII masked when `pii` is set. */
export function diffFields(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
  fields: readonly string[],
  opts: { pii?: boolean } = {},
): FieldChange[] {
  const out: FieldChange[] = [];
  for (const f of fields) {
    const o = before ? (before[f] ?? null) : null;
    const n = after[f] ?? null;
    if (JSON.stringify(o) === JSON.stringify(n)) continue;
    const mask = opts.pii && PII_FIELDS.has(f);
    out.push({ field: f, old: mask ? '[PII]' : o, new: mask ? '[PII]' : n });
  }
  return out;
}

/** Appends to the immutable audit log inside the caller's transaction (hash by trigger). */
export async function recordAudit(tx: DbOrTx, actor: Actor, ev: AuditEvent): Promise<void> {
  await tx.execute(sql`
    INSERT INTO audit_log (actor_user_id, actor_roles, on_behalf_of_user_id, action, category,
      entity_type, entity_id, opportunity_id, account_id, changes, reason, request_id, ip, user_agent)
    VALUES (${actor.userId}, string_to_array(${actor.roles.join(',')}, ',')::user_role[],
      ${actor.onBehalfOfUserId ?? null}, ${ev.action}, ${ev.category}, ${ev.entityType},
      ${ev.entityId}, ${ev.opportunityId ?? null}, ${ev.accountId ?? null},
      ${JSON.stringify(ev.changes ?? [])}::jsonb, ${ev.reason ?? null}, ${actor.requestId ?? null},
      ${actor.ip ?? null}::inet, ${actor.userAgent?.slice(0, 500) ?? null})
  `);
}
