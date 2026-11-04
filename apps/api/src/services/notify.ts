import type { UserRole } from '@wcrm/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { notifications, userRoles, users } from '../db/schema/index';
import type { MailTransport } from './mailer';

export interface NotifyInput {
  userIds?: string[];
  roles?: UserRole[];
  type: string;
  /** i18n key under `notifications.*` on the client. */
  titleKey: string;
  params?: Record<string, unknown>;
  entityType?: string;
  entityId?: string;
  link?: string;
  /** Idempotency key per user (e.g. `collections:<invoice>:D_PLUS_15`). */
  dedupeKey: string;
}

/** In-app notification per recipient (deduplicated) + optional e-mail through the transport. */
export async function notify(db: DbOrTx, n: NotifyInput, mailer?: MailTransport): Promise<number> {
  const ids = new Set(n.userIds ?? []);
  if (n.roles?.length) {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .where(and(inArray(userRoles.role, n.roles), eq(users.isActive, true)));
    rows.forEach((r) => ids.add(r.id));
  }
  if (!ids.size) return 0;
  const inserted = await db
    .insert(notifications)
    .values(
      [...ids].map((userId) => ({
        userId,
        type: n.type,
        titleKey: n.titleKey,
        params: n.params ?? {},
        entityType: n.entityType ?? null,
        entityId: n.entityId ?? null,
        link: n.link ?? null,
        dedupeKey: n.dedupeKey,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: notifications.id, userId: notifications.userId });
  if (mailer && inserted.length) {
    const recipients = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(
        inArray(
          users.id,
          inserted.map((i) => i.userId),
        ),
      );
    for (const r of recipients) {
      await mailer.send({
        to: r.email,
        subject: `[CRM] ${n.titleKey}`,
        text: JSON.stringify(n.params ?? {}),
      });
    }
    await db
      .update(notifications)
      .set({ emailedAt: sql`now()` })
      .where(
        inArray(
          notifications.id,
          inserted.map((i) => i.id),
        ),
      );
  }
  return inserted.length;
}
