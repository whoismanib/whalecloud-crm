import type { UserRole } from '../enums';
import type { RuleFailure } from './common';

export interface Delegation {
  delegatorUserId: string;
  delegateUserId: string;
  role: UserRole;
  startsOn: string;
  endsOn: string;
  revokedAt?: string | Date | null;
}

/** ADM-04: a delegation is in force on `today` when not revoked and within its dates. */
export function delegationActive(d: Delegation, today: string): boolean {
  return !d.revokedAt && d.startsOn <= today && today <= d.endsOn;
}

/** ADM-04: the delegator must hold the role; no self-delegation; valid, non-past date range. */
export function delegationFailures(
  d: Omit<Delegation, 'revokedAt'>,
  delegatorRoles: readonly UserRole[],
  today: string,
): RuleFailure[] {
  const f: RuleFailure[] = [];
  if (d.delegatorUserId === d.delegateUserId) f.push({ code: 'DELEGATION_SELF' });
  if (!delegatorRoles.includes(d.role))
    f.push({ code: 'DELEGATION_ROLE_NOT_HELD', params: { role: d.role } });
  if (d.endsOn < d.startsOn) f.push({ code: 'DATE_RANGE_INVALID' });
  else if (d.endsOn < today) f.push({ code: 'DELEGATION_IN_PAST' });
  return f;
}

/** Roles and user ids the delegate may act for today (approval inbox and decisions). */
export function delegatedAuthority(
  delegations: readonly Delegation[],
  delegateUserId: string,
  today: string,
): { roles: UserRole[]; onBehalfOf: { userId: string; role: UserRole }[] } {
  const active = delegations.filter(
    (d) => d.delegateUserId === delegateUserId && delegationActive(d, today),
  );
  return {
    roles: [...new Set(active.map((d) => d.role))],
    onBehalfOf: active.map((d) => ({ userId: d.delegatorUserId, role: d.role })),
  };
}
