import {
  Alert,
  Anchor,
  Badge,
  Button,
  Group,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  Title,
} from '@mantine/core';
import { IconDownload } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { FORECAST_CATEGORIES, toCsv } from '@wcrm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { canDo, useMe } from '../../auth/useMe';
import { RuleErrors } from '../../components/RuleErrors';
import { PageHeader, ScrollTable, StageBadge } from '../../components/ui';
import { fmtDate, fmtDateTime, fmtMoney, fmtPct, todayIso } from '../../lib/format';
import { useAction } from '../../lib/mutations';

type Totals = Record<
  'commit' | 'probable' | 'pipeline' | 'weighted' | 'commitPlusProbable',
  string
>;
interface Item {
  opportunityId: string;
  name: string;
  accountName: string;
  ownerName: string;
  stage: number;
  forecastCategory: string | null;
  amount: string;
  expectedCloseDate: string;
  probability: number;
  warnings: string[];
  stale: boolean;
}
interface Snapshot {
  id: string;
  isoYear: number;
  isoWeek: number;
  takenOn: string;
  takenAt: string;
  totals: { year: Totals; quarter: Totals & { from: string; to: string }; currency: string };
}
interface Report {
  snapshot: Snapshot | null;
  previousSnapshotId: string | null;
  topDeals: {
    opportunityId: string;
    name: string;
    accountName: string;
    stage: number;
    forecastCategory: string | null;
    amountCny: string;
    expectedCloseDate: string;
  }[];
  changes: {
    opportunityId: string;
    name?: string;
    change: string;
    from?: string | number;
    to?: string | number;
  }[];
}

const CAT_COLOR: Record<string, string> = { COMMIT: 'green', PROBABLE: 'blue', PIPELINE: 'gray' };
const TOTAL_KEYS = ['commit', 'probable', 'pipeline', 'weighted'] as const;

function quarterOf(d: string) {
  return `${d.slice(0, 4)}Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;
}
function prevQuarter(p: string) {
  const y = Number(p.slice(0, 4));
  const q = Number(p.slice(5));
  return q === 1 ? `${y - 1}Q4` : `${y}Q${q - 1}`;
}

function download(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function TotalsGrid({ totals, testId }: { totals: Totals; testId?: string }) {
  const { t } = useTranslation();
  return (
    <SimpleGrid cols={{ base: 2, md: 4 }} data-testid={testId}>
      {TOTAL_KEYS.map((k) => (
        <Paper key={k} withBorder p="sm">
          <Text size="xs" c="dimmed">
            {t(`p2:forecast.totals.${k}`)}
          </Text>
          <Text fw={700}>{fmtMoney(totals[k], 'CNY')}</Text>
        </Paper>
      ))}
    </SimpleGrid>
  );
}

/** P12: weekly forecast — categories, Mon/Tue/Wed cadence, snapshots, report and accuracy ±10 %. */
export default function ForecastPage() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const cur = useQuery({
    queryKey: ['forecast-current'],
    queryFn: () =>
      api.get<{ cadence: string; totals: Totals; items: Item[]; from: string; to: string }>(
        '/forecast/current',
      ),
  });
  const snaps = useQuery({
    queryKey: ['forecast-snapshots'],
    queryFn: () => api.get<Snapshot[]>('/forecast/snapshots'),
  });
  const report = useQuery({
    queryKey: ['forecast-report'],
    queryFn: () => api.get<Report>('/forecast/report'),
  });
  const [period, setPeriod] = useState(quarterOf(todayIso()));
  const acc = useQuery({
    queryKey: ['forecast-accuracy', period],
    queryFn: () =>
      api.get<{
        period: string;
        snapshotOn: string | null;
        forecast: string;
        actual: string;
        deviation: number | null;
        withinTolerance: boolean | null;
      }>(`/forecast/accuracy?period=${period}`),
  });
  const setCat = useAction(
    ({ id, cat }: { id: string; cat: string | null }) =>
      api.patch(`/opportunities/${id}/forecast`, { forecastCategory: cat }),
    { invalidate: [['forecast-current']] },
  );
  const snap = useAction(() => api.post('/forecast/snapshots'), {
    invalidate: [['forecast-snapshots'], ['forecast-report']],
  });
  const canWrite = canDo(me, 'P12', 'write');
  const r = report.data;
  const changeValue = (change: string, v: string | number | undefined) =>
    v === undefined
      ? ''
      : change === 'CATEGORY'
        ? t(`enums:forecast.${v}`, { defaultValue: String(v) })
        : change === 'SLIPPED'
          ? fmtDate(String(v))
          : typeof v === 'number'
            ? t(`enums:stage.${v}`)
            : String(v);
  const exportReport = () => {
    if (!r) return;
    const rows = [
      ...r.topDeals.map((d) => ({
        section: 'TOP',
        opportunity: d.name,
        account: d.accountName,
        stage: d.stage,
        category: d.forecastCategory,
        amountCny: d.amountCny,
        close: d.expectedCloseDate,
        change: '',
      })),
      ...r.changes.map((c) => ({
        section: 'CHANGE',
        opportunity: c.name ?? c.opportunityId,
        account: '',
        stage: c.to ?? '',
        category: '',
        amountCny: '',
        close: '',
        change: `${c.change} ${c.from ?? ''}→${c.to ?? ''}`,
      })),
    ];
    download(
      `forecast_W${r.snapshot?.isoWeek ?? ''}.csv`,
      toCsv(rows, [
        'section',
        'opportunity',
        'account',
        'stage',
        'category',
        'amountCny',
        'close',
        'change',
      ]),
    );
  };
  return (
    <Stack>
      <PageHeader
        title={t('p2:forecast.title')}
        right={
          canDo(me, 'P12', 'approve') && (
            <Button size="xs" onClick={() => snap.mutate(undefined)} data-testid="take-snapshot">
              {t('p2:forecast.takeSnapshot')}
            </Button>
          )
        }
      />
      {cur.data && (
        <Alert color={cur.data.cadence === 'NONE' ? 'gray' : 'blue'} data-testid="cadence">
          {t(`p2:forecast.cadence.${cur.data.cadence}`)}
        </Alert>
      )}
      <RuleErrors error={cur.error ?? setCat.error ?? snap.error} />
      <Tabs defaultValue="current">
        <Tabs.List>
          <Tabs.Tab value="current">{t('p2:forecast.current')}</Tabs.Tab>
          <Tabs.Tab value="report">{t('p2:forecast.report')}</Tabs.Tab>
          <Tabs.Tab value="history">{t('p2:forecast.history')}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="current" pt="md">
          <Stack>
            {cur.data && <TotalsGrid totals={cur.data.totals} testId="forecast-totals" />}
            <ScrollTable striped withTableBorder data-testid="forecast-items">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('fields.name')}</Table.Th>
                  <Table.Th>{t('fields.owner')}</Table.Th>
                  <Table.Th>{t('fields.stage')}</Table.Th>
                  <Table.Th>{t('fields.amount')}</Table.Th>
                  <Table.Th>{t('fields.expectedClose')}</Table.Th>
                  <Table.Th>{t('fields.forecast')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(cur.data?.items ?? []).map((i) => (
                  <Table.Tr key={i.opportunityId}>
                    <Table.Td>
                      <Anchor component={Link} to={`/oportunidades/${i.opportunityId}`} size="sm">
                        {i.name}
                      </Anchor>
                      {i.stale && (
                        <Badge ml={4} size="xs" color="orange" variant="light">
                          {t('p2:forecast.stale')}
                        </Badge>
                      )}
                      {i.warnings.map((w) => (
                        <Text key={w} size="xs" c="orange">
                          {t(`errors:rules.${w}`, { defaultValue: w })}
                        </Text>
                      ))}
                    </Table.Td>
                    <Table.Td>{i.ownerName}</Table.Td>
                    <Table.Td>
                      <StageBadge stage={i.stage} />
                    </Table.Td>
                    <Table.Td>{fmtMoney(i.amount, 'CNY')}</Table.Td>
                    <Table.Td>{fmtDate(i.expectedCloseDate)}</Table.Td>
                    <Table.Td>
                      <Select
                        size="xs"
                        w={140}
                        disabled={!canWrite}
                        clearable
                        data={FORECAST_CATEGORIES.map((c) => ({
                          value: c,
                          label: t(`enums:forecast.${c}`),
                        }))}
                        value={i.forecastCategory}
                        onChange={(v) => setCat.mutate({ id: i.opportunityId, cat: v })}
                      />
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </ScrollTable>
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="report" pt="md">
          {!r?.snapshot ? (
            <Text c="dimmed">{t('p2:forecast.noSnapshot')}</Text>
          ) : (
            <Stack data-testid="forecast-report">
              <Group justify="space-between">
                <Title order={5}>
                  {t('p2:forecast.week', { week: r.snapshot.isoWeek, year: r.snapshot.isoYear })} ·{' '}
                  {fmtDate(r.snapshot.takenOn)}
                </Title>
                <Button
                  size="xs"
                  variant="default"
                  leftSection={<IconDownload size={14} />}
                  onClick={exportReport}
                >
                  CSV
                </Button>
              </Group>
              <Text size="sm" fw={600}>
                {t('p2:forecast.quarter')}
              </Text>
              <TotalsGrid totals={r.snapshot.totals.quarter} />
              <Title order={6}>{t('p2:forecast.topDeals')}</Title>
              <ScrollTable striped withTableBorder>
                <Table.Tbody>
                  {r.topDeals.map((d) => (
                    <Table.Tr key={d.opportunityId}>
                      <Table.Td>
                        {d.name}
                        <Text size="xs" c="dimmed">
                          {d.accountName}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <StageBadge stage={d.stage} />
                      </Table.Td>
                      <Table.Td>
                        {d.forecastCategory && (
                          <Badge color={CAT_COLOR[d.forecastCategory]} variant="light">
                            {t(`enums:forecast.${d.forecastCategory}`)}
                          </Badge>
                        )}
                      </Table.Td>
                      <Table.Td>{fmtMoney(d.amountCny, 'CNY')}</Table.Td>
                      <Table.Td>{fmtDate(d.expectedCloseDate)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </ScrollTable>
              <Title order={6}>{t('p2:forecast.changes')}</Title>
              {r.changes.length === 0 ? (
                <Text size="sm" c="dimmed">
                  {t('p2:forecast.noChanges')}
                </Text>
              ) : (
                r.changes.map((c) => (
                  <Text key={`${c.opportunityId}${c.change}`} size="sm">
                    <Badge size="xs" variant="light" mr={4}>
                      {t(`p2:forecast.change.${c.change}`)}
                    </Badge>
                    {c.name}{' '}
                    {c.from !== undefined
                      ? `${changeValue(c.change, c.from)} → ${changeValue(c.change, c.to)}`
                      : ''}
                  </Text>
                ))
              )}
            </Stack>
          )}
        </Tabs.Panel>
        <Tabs.Panel value="history" pt="md">
          <Stack>
            <Paper withBorder p="sm" data-testid="forecast-accuracy">
              <Group>
                <Title order={6}>{t('p2:forecast.accuracy')}</Title>
                <Select
                  size="xs"
                  w={120}
                  data={[
                    quarterOf(todayIso()),
                    prevQuarter(quarterOf(todayIso())),
                    prevQuarter(prevQuarter(quarterOf(todayIso()))),
                  ]}
                  value={period}
                  onChange={(v) => v && setPeriod(v)}
                />
              </Group>
              {acc.data && (
                <Group mt="xs" gap="xl">
                  <Text size="sm">
                    {t('p2:forecast.forecastAmount')}: <b>{fmtMoney(acc.data.forecast, 'CNY')}</b>{' '}
                    {acc.data.snapshotOn ? `(${fmtDate(acc.data.snapshotOn)})` : ''}
                  </Text>
                  <Text size="sm">
                    {t('p2:forecast.actual')}: <b>{fmtMoney(acc.data.actual, 'CNY')}</b>
                  </Text>
                  <Badge
                    color={
                      acc.data.withinTolerance
                        ? 'green'
                        : acc.data.withinTolerance === false
                          ? 'red'
                          : 'gray'
                    }
                  >
                    {acc.data.deviation === null ? '—' : fmtPct(acc.data.deviation)}
                  </Badge>
                </Group>
              )}
              <Text size="xs" c="dimmed">
                {t('p2:forecast.accuracyHint')}
              </Text>
            </Paper>
            <ScrollTable striped withTableBorder data-testid="snapshots">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('p2:forecast.weekCol')}</Table.Th>
                  <Table.Th>{t('p2:forecast.takenAt')}</Table.Th>
                  {TOTAL_KEYS.map((k) => (
                    <Table.Th key={k}>{t(`p2:forecast.totals.${k}`)}</Table.Th>
                  ))}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(snaps.data ?? []).map((s) => (
                  <Table.Tr key={s.id}>
                    <Table.Td>
                      {s.isoYear}-W{String(s.isoWeek).padStart(2, '0')}
                    </Table.Td>
                    <Table.Td>{fmtDateTime(s.takenAt)}</Table.Td>
                    {TOTAL_KEYS.map((k) => (
                      <Table.Td key={k}>{fmtMoney(s.totals.year[k], 'CNY')}</Table.Td>
                    ))}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </ScrollTable>
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
