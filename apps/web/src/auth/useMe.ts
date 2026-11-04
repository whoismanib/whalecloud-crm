import { useQuery } from '@tanstack/react-query';
import type { ProcessCode, RaciLetter, UserRole } from '@wcrm/shared';
import { api, ApiError } from '../api/client';

export interface Me {
  id: string;
  email: string;
  fullName: string;
  locale: string;
  timezone: string;
  roles: UserRole[];
  mfaVerified: boolean;
  mfaEnabled: boolean;
  permissions: Record<ProcessCode, RaciLetter[]>;
  actionRoles: Record<string, boolean>;
  visibleStages: number[];
  /** ADM-04: roles delegated to this user today. */
  delegatedRoles?: UserRole[];
}

export function useMe() {
  return useQuery<Me | null>({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.get<Me>('/auth/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
  });
}

/** Mirrors the API guard: R/A write, any letter view (ARCHITECTURE §6.4). */
export function canDo(
  me: Me | null | undefined,
  process: ProcessCode,
  action: 'view' | 'write' | 'approve',
) {
  const letters = me?.permissions?.[process] ?? [];
  if (action === 'view') return letters.length > 0;
  if (action === 'write') return letters.includes('R') || letters.includes('A');
  return letters.includes('A');
}

export function hasAction(me: Me | null | undefined, key: string) {
  return Boolean(me?.actionRoles?.[key]);
}
