import { delegatedAuthority, type UserRole } from '@wcrm/shared';
import { and, eq, isNull, lte, gte } from 'drizzle-orm';
import type { DbOrTx } from '../db/client';
import { approvalDelegations } from '../db/schema/index';

/** ADM-04: roles the user may approve for today on behalf of absent colleagues. */
export async function delegatedFor(db: DbOrTx, userId: string, today: string) {
  const rows = await db
    .select()
    .from(approvalDelegations)
    .where(
      and(
        eq(approvalDelegations.delegateUserId, userId),
        isNull(approvalDelegations.revokedAt),
        lte(approvalDelegations.startsOn, today),
        gte(approvalDelegations.endsOn, today),
      ),
    );
  return delegatedAuthority(
    rows.map((r) => ({ ...r, role: r.role as UserRole })),
    userId,
    today,
  );
}
