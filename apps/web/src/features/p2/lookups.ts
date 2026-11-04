import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';

export interface AccountLite {
  id: string;
  name: string;
}
export interface ContractLite {
  id: string;
  title: string;
  type: string;
  status: string;
  accountId: string;
  accountName: string;
}

export function useAccountsLite(enabled = true) {
  return useQuery({
    queryKey: ['accounts', ''],
    queryFn: () => api.get<AccountLite[]>('/accounts'),
    enabled,
  });
}

export function useContractsLite(enabled = true) {
  return useQuery({
    queryKey: ['contracts', 'all'],
    queryFn: () => api.get<ContractLite[]>('/contracts'),
    enabled,
  });
}

export const opt = (rows: { id: string; name?: string; title?: string }[] | undefined) =>
  (rows ?? []).map((r) => ({ value: r.id, label: r.name ?? r.title ?? r.id }));
