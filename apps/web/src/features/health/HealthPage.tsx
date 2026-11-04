import { Group, SegmentedControl, Stack, Table, Text, TextInput } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { HEALTH_STATUSES } from '@wcrm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { RuleErrors } from '../../components/RuleErrors';
import { EnumBadge, PageHeader, ScrollTable, StageBadge } from '../../components/ui';
import { fmtMoney } from '../../lib/format';

interface HealthRow {
  id: string;
  code: string;
  name: string;
  accountName: string;
  ownerName: string;
  stage: number;
  amountUsd: string;
  section: 'PIPELINE' | 'DELIVERY';
  legacyStatus: string | null;
  score: number | null;
  status: string;
  idleBusinessDays: number;
  reasons: { code: string; params?: Record<string, unknown> }[];
}

export default function HealthPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const [status, setStatus] = useState(params.get('status') ?? 'ALL');
  const [q, setQ] = useState('');
  const data = useQuery({
    queryKey: ['health'],
    queryFn: () => api.get<HealthRow[]>('/dashboard/health'),
  });
  const rows = (data.data ?? [])
    .filter((r) => status === 'ALL' || r.status === status)
    .filter((r) => !q || `${r.name} ${r.accountName}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (a.score ?? 101) - (b.score ?? 101));
  const accounts = [...new Set(rows.map((r) => r.accountName))];
  return (
    <Stack>
      <PageHeader
        title={t('health.title')}
        right={
          <>
            <TextInput
              size="xs"
              placeholder={t('actions.search')}
              value={q}
              onChange={(e) => setQ(e.currentTarget.value)}
            />
            <SegmentedControl
              size="xs"
              value={status}
              onChange={setStatus}
              data={[
                { value: 'ALL', label: t('ui.all') },
                ...HEALTH_STATUSES.filter((s) => !['CLOSED', 'ON_HOLD'].includes(s)).map((s) => ({
                  value: s,
                  label: t(`enums:health.${s}`),
                })),
              ]}
            />
          </>
        }
      />
      <RuleErrors error={data.error} />
      {accounts.map((acc) => (
        <Stack key={acc} gap={4}>
          <Text fw={700}>{acc}</Text>
          <ScrollTable striped withTableBorder data-testid="health-table">
            <Table.Thead>
              <Table.Tr>
                <Table.Th w="30%">{t('fields.name')}</Table.Th>
                <Table.Th>{t('health.section')}</Table.Th>
                <Table.Th>{t('fields.stage')}</Table.Th>
                <Table.Th>{t('health.score')}</Table.Th>
                <Table.Th>{t('fields.status')}</Table.Th>
                <Table.Th>{t('health.reasons')}</Table.Th>
                <Table.Th>{t('fields.amount')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows
                .filter((r) => r.accountName === acc)
                .map((r) => (
                  <Table.Tr key={r.id}>
                    <Table.Td>
                      <Link to={`/oportunidades/${r.id}`}>{r.name}</Link>
                      <Text size="xs" c="dimmed">
                        {r.code} · {r.ownerName} {r.legacyStatus ? `· ${r.legacyStatus}` : ''}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      {r.section === 'DELIVERY' ? t('health.delivery') : t('health.pipeline')}
                    </Table.Td>
                    <Table.Td>
                      <StageBadge stage={r.stage} />
                    </Table.Td>
                    <Table.Td>
                      <Text
                        fw={700}
                        c={
                          r.score === null
                            ? undefined
                            : r.score >= 70
                              ? 'green'
                              : r.score >= 40
                                ? 'yellow.7'
                                : 'red'
                        }
                      >
                        {r.score ?? '—'}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <EnumBadge ns="health" value={r.status} />
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4}>
                        {r.reasons.map((x, i) => (
                          <Text key={i} size="xs">
                            {t(`health.reason.${x.code}`, x.params ?? {})} (
                            {x.code === 'IDLE' || x.code === 'SLA_OVERDUE' ? '' : ''}
                            {(x as { points?: number }).points})
                            {i < r.reasons.length - 1 ? ' ·' : ''}
                          </Text>
                        ))}
                      </Group>
                    </Table.Td>
                    <Table.Td>{fmtMoney(r.amountUsd)}</Table.Td>
                  </Table.Tr>
                ))}
            </Table.Tbody>
          </ScrollTable>
        </Stack>
      ))}
    </Stack>
  );
}
