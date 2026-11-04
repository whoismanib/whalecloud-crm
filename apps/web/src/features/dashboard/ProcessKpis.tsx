import { Badge, Paper, Table, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { RuleErrors } from '../../components/RuleErrors';
import { ScrollTable } from '../../components/ui';
import { fmtMoney, fmtNumber, fmtPct } from '../../lib/format';

interface ProcessKpi {
  process: string;
  code: string;
  unit: 'PCT' | 'COUNT' | 'DAYS' | 'CNY' | 'NUMBER';
  value: number | null;
  target: number | null;
  rag: string;
  available: boolean;
}

const RAG: Record<string, string> = { GREEN: 'green', AMBER: 'yellow', RED: 'red', NONE: 'gray' };

/** DASH-05: KPIs per process P1–P16 (KPIS.md §4). */
export function ProcessKpis() {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['process-kpis'],
    queryFn: () => api.get<ProcessKpi[]>('/dashboard/process-kpis'),
  });
  const fmt = (unit: ProcessKpi['unit'], v: number | null) =>
    v === null
      ? '—'
      : unit === 'PCT'
        ? fmtPct(v)
        : unit === 'CNY'
          ? fmtMoney(v, 'CNY')
          : unit === 'DAYS'
            ? t('tickets.days', { count: v })
            : fmtNumber(v, unit === 'COUNT' ? 0 : 1);
  return (
    <Paper withBorder p="md" data-testid="process-kpis">
      <Title order={4}>{t('p3:processKpis.title')}</Title>
      <Text size="xs" c="dimmed" mb="xs">
        {t('p3:processKpis.hint')}
      </Text>
      <RuleErrors error={q.error} />
      <ScrollTable striped minWidth={560}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('p3:processKpis.process')}</Table.Th>
            <Table.Th>KPI</Table.Th>
            <Table.Th>{t('p3:processKpis.value')}</Table.Th>
            <Table.Th>{t('p3:processKpis.target')}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {(q.data ?? []).map((k) => (
            <Table.Tr key={k.code} data-testid={`pkpi-${k.code}`}>
              <Table.Td>{k.process}</Table.Td>
              <Table.Td>{t(`p3:processKpis.codes.${k.code}`)}</Table.Td>
              <Table.Td>
                {k.available ? (
                  <Badge color={RAG[k.rag]} variant={k.rag === 'NONE' ? 'outline' : 'light'}>
                    {fmt(k.unit, k.value)}
                  </Badge>
                ) : (
                  <Text size="xs" c="dimmed">
                    {t('p3:processKpis.pending')}
                  </Text>
                )}
              </Table.Td>
              <Table.Td>
                {k.target === null
                  ? t('p3:processKpis.tracking')
                  : k.code === 'P12_FORECAST_ACCURACY'
                    ? `±${fmtPct(k.target, 0)}`
                    : fmt(k.unit, k.target)}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </ScrollTable>
    </Paper>
  );
}
