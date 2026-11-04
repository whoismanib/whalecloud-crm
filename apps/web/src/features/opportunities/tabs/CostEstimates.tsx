import {
  Badge,
  Button,
  Group,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { RESOURCE_TYPES } from '@wcrm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../api/client';
import { useCatalogs } from '../../../api/catalogs';
import { canDo, useMe } from '../../../auth/useMe';
import { RuleErrors } from '../../../components/RuleErrors';
import { ScrollTable } from '../../../components/ui';
import { fmtDateTime } from '../../../lib/format';
import { useAction } from '../../../lib/mutations';

interface Estimate {
  id: string;
  area: string;
  resourceType: string;
  personMonths: string | null;
  mandatory: boolean;
  assigneeUserId: string;
  assigneeName: string;
  signedAt: string | null;
  signedByName: string | null;
  notes: string | null;
}

/** P5-04: person-month estimates assigned by China Sales to R&D / delivery China, signed by the author. */
export function CostEstimates({
  priceRequestId,
  status,
}: {
  priceRequestId: string;
  status: string;
}) {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const cat = useCatalogs();
  const key = ['cost-estimates', priceRequestId];
  const q = useQuery({
    queryKey: key,
    queryFn: () => api.get<Estimate[]>(`/price-requests/${priceRequestId}/cost-estimates`),
  });
  const inv = { invalidate: [key, ['priceRequest', priceRequestId]] };
  const [v, setV] = useState({ area: '', resourceType: 'CN_INTERNAL_RD', assigneeUserId: '' });
  const [pm, setPm] = useState<Record<string, string>>({});
  const assign = useAction(
    () => api.post(`/price-requests/${priceRequestId}/cost-estimates`, [v]),
    {
      ...inv,
      onDone: () => setV({ ...v, area: '', assigneeUserId: '' }),
    },
  );
  const save = useAction(
    (id: string) => api.patch(`/cost-estimates/${id}`, { personMonths: pm[id] }),
    inv,
  );
  const sign = useAction((id: string) => api.post(`/cost-estimates/${id}/sign`), inv);
  const open = ['SUBMITTED', 'COSTING', 'BUILDING'].includes(status);
  const users = (cat.data?.users ?? [])
    .filter((u) => u.roles.some((r) => r === 'CHINA_DELIVERY' || r === 'CHINA_SALES'))
    .map((u) => ({ value: u.id, label: u.fullName }));
  return (
    <Paper withBorder p="md" data-testid="cost-estimates">
      <Title order={5}>{t('p3:cost.title')}</Title>
      <Text size="xs" c="dimmed" mb="xs">
        {t('p3:cost.hint')}
      </Text>
      <ScrollTable minWidth={620}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('p3:cost.area')}</Table.Th>
            <Table.Th>{t('p3:cost.resourceType')}</Table.Th>
            <Table.Th>{t('p3:rfp.assignee')}</Table.Th>
            <Table.Th>{t('p3:cost.personMonths')}</Table.Th>
            <Table.Th>{t('p3:cost.signature')}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {(q.data ?? []).map((e) => {
            const mine = e.assigneeUserId === me?.id;
            return (
              <Table.Tr key={e.id}>
                <Table.Td>{e.area}</Table.Td>
                <Table.Td>{t(`p3:resourceType.${e.resourceType}`)}</Table.Td>
                <Table.Td>{e.assigneeName}</Table.Td>
                <Table.Td>
                  {mine && open ? (
                    <Group gap={4} wrap="nowrap">
                      <NumberInput
                        size="xs"
                        w={90}
                        min={0}
                        decimalScale={2}
                        value={pm[e.id] ?? e.personMonths ?? ''}
                        onChange={(x) => setPm({ ...pm, [e.id]: String(x) })}
                      />
                      <Button size="compact-xs" variant="default" onClick={() => save.mutate(e.id)}>
                        {t('actions.save')}
                      </Button>
                    </Group>
                  ) : (
                    (e.personMonths ?? '—')
                  )}
                </Table.Td>
                <Table.Td>
                  {e.signedAt ? (
                    <Badge color="green" variant="light">
                      {e.signedByName} · {fmtDateTime(e.signedAt)}
                    </Badge>
                  ) : mine && open && e.personMonths !== null ? (
                    <Button size="compact-xs" onClick={() => sign.mutate(e.id)}>
                      {t('p3:cost.sign')}
                    </Button>
                  ) : (
                    <Badge color="gray" variant="light">
                      {t('p3:cost.unsigned')}
                    </Badge>
                  )}
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </ScrollTable>
      {open && canDo(me, 'P5', 'write') && (
        <SimpleGrid cols={{ base: 1, sm: 4 }} mt="xs">
          <TextInput
            size="xs"
            label={t('p3:cost.area')}
            value={v.area}
            onChange={(e) => setV({ ...v, area: e.currentTarget.value })}
          />
          <Select
            size="xs"
            label={t('p3:cost.resourceType')}
            data={RESOURCE_TYPES.map((r) => ({ value: r, label: t(`p3:resourceType.${r}`) }))}
            value={v.resourceType}
            onChange={(x) => x && setV({ ...v, resourceType: x })}
          />
          <Select
            size="xs"
            label={t('p3:rfp.assignee')}
            searchable
            data={users}
            value={v.assigneeUserId || null}
            onChange={(x) => setV({ ...v, assigneeUserId: x ?? '' })}
          />
          <Button size="xs" mt={22} onClick={() => assign.mutate(undefined)}>
            {t('p3:cost.assign')}
          </Button>
        </SimpleGrid>
      )}
      <RuleErrors error={assign.error ?? save.error ?? sign.error ?? q.error} />
    </Paper>
  );
}
