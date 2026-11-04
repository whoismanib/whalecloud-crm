import {
  Badge,
  Button,
  Group,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { useCatalogs } from '../../api/catalogs';
import { canDo, useMe } from '../../auth/useMe';
import { RuleErrors } from '../../components/RuleErrors';
import { ScrollTable } from '../../components/ui';
import { fmtDate, todayIso } from '../../lib/format';
import { useAction } from '../../lib/mutations';

interface Delegation {
  id: string;
  delegatorUserId: string;
  delegatorName: string;
  delegateName: string;
  role: string;
  startsOn: string;
  endsOn: string;
  reason: string;
  revokedAt: string | null;
  active: boolean;
}

/** ADM-04: temporary delegation of approvals during absences (audited, revocable). */
export function DelegationsPanel() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const cat = useCatalogs();
  const q = useQuery({
    queryKey: ['delegations'],
    queryFn: () => api.get<Delegation[]>('/delegations'),
  });
  const isAdmin = canDo(me, 'ADM', 'write');
  const [v, setV] = useState({
    delegatorUserId: '',
    delegateUserId: '',
    role: me?.roles[0] ?? '',
    startsOn: todayIso(),
    endsOn: '',
    reason: '',
  });
  const inv = { invalidate: [['delegations'], ['me'], ['approvals']] };
  const create = useAction(
    () =>
      api.post('/delegations', {
        ...v,
        delegatorUserId: v.delegatorUserId || undefined,
      }),
    { ...inv, onDone: () => setV({ ...v, delegateUserId: '', endsOn: '', reason: '' }) },
  );
  const revoke = useAction((id: string) => api.del(`/delegations/${id}`), inv);
  const users = cat.data?.users ?? [];
  const delegator = users.find((u) => u.id === (v.delegatorUserId || me?.id));
  const roles = (delegator?.roles ?? me?.roles ?? []).map((r) => ({
    value: r,
    label: t(`enums:role.${r}`),
  }));
  return (
    <Paper withBorder p="md" data-testid="delegations">
      <Title order={5}>{t('p3:delegation.title')}</Title>
      <Text size="xs" c="dimmed" mb="xs">
        {t('p3:delegation.hint')}
      </Text>
      {(me?.delegatedRoles ?? []).length > 0 && (
        <Badge color="orange" mb="xs">
          {t('p3:delegation.actingAs', {
            roles: (me?.delegatedRoles ?? []).map((r) => t(`enums:role.${r}`)).join(', '),
          })}
        </Badge>
      )}
      <ScrollTable minWidth={520}>
        <Table.Tbody>
          {(q.data ?? []).map((d) => (
            <Table.Tr key={d.id}>
              <Table.Td>
                {d.delegatorName} → {d.delegateName}
                <Text size="xs" c="dimmed">
                  {t(`enums:role.${d.role}`)} · {d.reason}
                </Text>
              </Table.Td>
              <Table.Td>
                {fmtDate(d.startsOn)} → {fmtDate(d.endsOn)}
              </Table.Td>
              <Table.Td>
                <Badge color={d.revokedAt ? 'gray' : d.active ? 'green' : 'blue'} variant="light">
                  {t(
                    `p3:delegation.${d.revokedAt ? 'revoked' : d.active ? 'active' : 'scheduled'}`,
                  )}
                </Badge>
              </Table.Td>
              <Table.Td>
                {!d.revokedAt && (d.delegatorUserId === me?.id || isAdmin) && (
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color="red"
                    onClick={() => revoke.mutate(d.id)}
                  >
                    {t('p3:delegation.revoke')}
                  </Button>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </ScrollTable>
      <Stack gap="xs" mt="sm">
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          {isAdmin && (
            <Select
              size="xs"
              label={t('p3:delegation.delegator')}
              searchable
              clearable
              data={users.map((u) => ({ value: u.id, label: u.fullName }))}
              value={v.delegatorUserId || null}
              onChange={(x) => setV({ ...v, delegatorUserId: x ?? '', role: '' })}
            />
          )}
          <Select
            size="xs"
            label={t('p3:delegation.delegate')}
            searchable
            data={users
              .filter((u) => u.id !== (v.delegatorUserId || me?.id))
              .map((u) => ({ value: u.id, label: u.fullName }))}
            value={v.delegateUserId || null}
            onChange={(x) => setV({ ...v, delegateUserId: x ?? '' })}
            data-testid="delegation-delegate"
          />
          <Select
            size="xs"
            label={t('p3:delegation.role')}
            data={roles}
            value={v.role || null}
            onChange={(x) => setV({ ...v, role: x ?? '' })}
          />
          <TextInput
            size="xs"
            type="date"
            label={t('p2:distributor.startsOn')}
            value={v.startsOn}
            onChange={(e) => setV({ ...v, startsOn: e.currentTarget.value })}
          />
          <TextInput
            size="xs"
            type="date"
            label={t('p2:distributor.endsOn')}
            value={v.endsOn}
            onChange={(e) => setV({ ...v, endsOn: e.currentTarget.value })}
          />
          <TextInput
            size="xs"
            label={t('fields.reason')}
            value={v.reason}
            onChange={(e) => setV({ ...v, reason: e.currentTarget.value })}
          />
        </SimpleGrid>
        <RuleErrors error={create.error ?? revoke.error ?? q.error} />
        <Group>
          <Button
            size="xs"
            onClick={() => create.mutate(undefined)}
            data-testid="delegation-create"
          >
            {t('p3:delegation.create')}
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}
