import { and, eq, inArray } from 'drizzle-orm';
import type { DbOrTx } from '../../db/client';
import { approvalRequests, approvalSteps, opportunities } from '../../db/schema/index';
import { recordAudit, type Actor } from '../../audit/record';

/**
 * P6-05: an approval stays valid 60 days or until scope/engine/milestones/price change.
 * Marks a PENDING/APPROVED request INVALIDATED and clears the opportunity's approval expiry.
 */
export async function invalidateApproval(
  tx: DbOrTx,
  requestId: string,
  actor: Actor,
  reason: string,
): Promise<boolean> {
  const [r] = await tx
    .select()
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.id, requestId),
        inArray(approvalRequests.status, ['PENDING', 'APPROVED']),
      ),
    );
  if (!r) return false;
  await tx
    .update(approvalRequests)
    .set({
      status: 'INVALIDATED',
      invalidatedAt: new Date(),
      invalidationReason: reason,
      updatedAt: new Date(),
    })
    .where(eq(approvalRequests.id, requestId));
  await tx
    .update(approvalSteps)
    .set({ status: 'CANCELLED', updatedAt: new Date() })
    .where(
      and(eq(approvalSteps.approvalRequestId, requestId), eq(approvalSteps.status, 'PENDING')),
    );
  await tx
    .update(opportunities)
    .set({ approvalExpiresOn: null })
    .where(eq(opportunities.id, r.opportunityId));
  await recordAudit(tx, actor, {
    action: 'APPROVAL_DECISION',
    category: 'APPROVAL',
    entityType: 'approval_request',
    entityId: requestId,
    opportunityId: r.opportunityId,
    changes: [{ field: 'status', old: r.status, new: 'INVALIDATED' }],
    reason,
  });
  return true;
}
