import { useQuery } from '@tanstack/react-query';
import type { Settings } from '@wcrm/shared';
import { api } from './client';

/** Parameters the SPA uses to pre-validate rules (same functions as the API). */
export function usePublicSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<{ settings: Settings }>('/settings/public'),
    staleTime: 300_000,
  });
}
