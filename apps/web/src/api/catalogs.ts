import { useQuery } from '@tanstack/react-query';
import { api } from './client';

export interface Catalogs {
  countries: { code: string; nameEs: string; nameEn: string; nameZh: string }[];
  billingEntities: { id: string; code: string; legalName: string }[];
  users: { id: string; fullName: string; email: string; roles: string[] }[];
}

export function useCatalogs() {
  return useQuery({
    queryKey: ['catalogs'],
    queryFn: () => api.get<Catalogs>('/catalogs'),
    staleTime: 300_000,
  });
}
