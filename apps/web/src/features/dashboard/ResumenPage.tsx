import {
  Card,
  Group,
  Paper,
  Progress,
  SegmentedControl,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../../api/client';
import { RuleErrors } from '../../components/RuleErrors';
import { EnumBadge, PageHeader } from '../../components/ui';
import { fmtMoney, fmtNumber, fmtPct } from '../../lib/format';

interface Kpi {
  code: string;
  unit: 'MM' | 'PCT' | 'RATIO' | 'COUNT' | 'BUSINESS_DAYS';
  value: number | null;
  target: number | null;
  rag: string;
  detail?: Record<string, unknown>;
}
interface Dashboard {
  year: number;
  asOf: string;
  currency: string;
  kpis: Kpi[];
  legacy: {
    projectsHealth: Record<string, number>;
    goal: {
      closedUsd: string;
      inFlightUsd: string;
      goalUsd: number | null;
      pct: number | null;
      pctPotential: number | null;
    };
    newPipelineUsd: string;
    toInvoice: string;
    toCollect: string;
    overdue: { amount: string; count: number };
    dueSoon: { amount: string; count: number };
    openIncidents: number;
    incidentsBallInWhale: number;
  };
  charts: {
    pipelineByStage: { stage: number; count: number; amountMm: number }[];
    funnel: { step: string; amountMm: number }[];
    monthly: { month: string; ssMm: number; paymentsMm: number }[];
  };
}

function KpiCard({ k, currency }: { k: Kpi; currency: string }) {
  const { t } = useTranslation();
  const value =
    k.value === null
      ? '—'
      : k.unit === 'PCT'
        ? fmtPct(k.value, 0)
        : k.unit === 'RATIO'
          ? `${fmtNumber(k.value, 2)}x`
          : k.unit === 'MM'
            ? fmtNumber(k.value, 1)
            : fmtNumber(k.value, 1);
  const unit =
    k.unit === 'MM'
      ? t('dashboard.unit.MM', { currency })
      : k.unit === 'BUSINESS_DAYS'
        ? t('dashboard.unit.BUSINESS_DAYS')
        : '';
  const target =
    k.code === 'RECOGNIZED_REVENUE'
      ? t('dashboard.tracking')
      : k.target === null
        ? t('dashboard.noTarget')
        : k.unit === 'PCT'
          ? fmtPct(k.target, 0)
          : k.unit === 'RATIO'
            ? `${k.target}x`
            : fmtNumber(k.target, 1);
  const d = k.detail ?? {};
  const detail =
    k.code === 'MIX_NEW_EXISTING'
      ? `${t('dashboard.detail.new', { value: fmtNumber(d.newMm as number) })} · ${t('dashboard.detail.existing', { value: fmtNumber(d.existingMm as number) })}`
      : k.code === 'PIPELINE_COVERAGE'
        ? t('dashboard.detail.newCoverage', {
            value: d.newRatio === null ? '—' : fmtNumber(d.newRatio as number, 2),
          })
        : k.code === 'PENDING_ACCEPTANCES' || k.code === 'OVERDUE_RECEIVABLES'
          ? t('dashboard.detail.amount', { value: fmtNumber(d.amountMm as number) })
          : k.code === 'PRICE_TIME' && d.pctWithin != null
            ? t('dashboard.detail.pctWithin', {
                value: fmtNumber((d.pctWithin as number) * 100, 0),
              })
            : k.code === 'PROFIT' && d.pct != null
              ? t('dashboard.detail.profitPct', { value: fmtNumber((d.pct as number) * 100, 1) })
              : '';
  return (
    <Card withBorder padding="md" radius="md" data-testid={`kpi-${k.code}`}>
      <Text size="sm" c="dimmed" fw={500} mih={40}>
        {t(`dashboard.kpi.${k.code}`)}
      </Text>
      <Group gap={6} align="baseline" mt={6}>
        <Text fz={28} fw={700} lh={1}>
          {value}
        </Text>
        <Text size="sm" c="dimmed">
          {unit}
        </Text>
      </Group>
      <Group justify="space-between" mt={6} wrap="nowrap">
        <Text size="xs" c="dimmed">
          {t('dashboard.target')}: {target}
        </Text>
        <EnumBadge ns="rag" value={k.rag} size="xs" style={{ flexShrink: 0 }} />
      </Group>
      {detail && (
        <Text size="xs" mt={2}>
          {detail}
        </Text>
      )}
    </Card>
  );
}

function Stat({
  label,
  value,
  color,
  to,
}: {
  label: string;
  value: string;
  color?: string;
  to?: string;
}) {
  const inner = (
    <Paper withBorder p="sm" radius="md" h="100%">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fz={20} fw={700} c={color}>
        {value}
      </Text>
    </Paper>
  );
  return to ? (
    <Link to={to} style={{ textDecoration: 'none', color: 'inherit' }}>
      {inner}
    </Link>
  ) : (
    inner
  );
}

export default function ResumenPage() {
  const { t } = useTranslation();
  const [currency, setCurrency] = useState('CNY');
  const q = useQuery({
    queryKey: ['dashboard', currency],
    queryFn: () => api.get<Dashboard>(`/dashboard/kpis?currency=${currency}`),
  });
  const d = q.data;
  return (
    <Stack>
      <PageHeader
        title={t('dashboard.title')}
        right={
          <SegmentedControl
            size="xs"
            value={currency}
            onChange={setCurrency}
            data={['CNY', 'USD', 'CLP']}
            aria-label={t('ui.currency')}
          />
        }
      />
      <RuleErrors error={q.error} />
      <Title order={4}>{t('dashboard.legacyTitle')}</Title>
      {!d ? (
        <Skeleton h={120} />
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} data-testid="legacy-cards">
          <Paper withBorder p="sm" radius="md">
            <Text size="xs" c="dimmed">
              {t('dashboard.cards.projects')}
            </Text>
            <Group gap="md" mt={4}>
              <Link to="/salud?status=HEALTHY" style={{ textDecoration: 'none' }}>
                <Text c="green" fw={700}>
                  {d.legacy.projectsHealth.HEALTHY} {t('dashboard.cards.healthy')}
                </Text>
              </Link>
              <Text c="yellow.7" fw={700}>
                {d.legacy.projectsHealth.AT_RISK} {t('dashboard.cards.atRisk')}
              </Text>
              <Text c="red" fw={700}>
                {d.legacy.projectsHealth.CRITICAL} {t('dashboard.cards.critical')}
              </Text>
              <Text c="dimmed" fw={700}>
                {d.legacy.projectsHealth.STALE} {t('dashboard.cards.stale')}
              </Text>
            </Group>
          </Paper>
          <Paper withBorder p="sm" radius="md">
            <Text size="xs" c="dimmed">
              {t('dashboard.cards.goal')}
            </Text>
            <Progress.Root size="lg" mt={6}>
              <Progress.Section value={(d.legacy.goal.pct ?? 0) * 100} color="green" />
              <Progress.Section
                value={Math.max(
                  0,
                  ((d.legacy.goal.pctPotential ?? 0) - (d.legacy.goal.pct ?? 0)) * 100,
                )}
                color="blue"
              />
            </Progress.Root>
            <Text size="xs" mt={4}>
              {t('dashboard.cards.closed')} {fmtMoney(d.legacy.goal.closedUsd)} ·{' '}
              {t('dashboard.cards.inFlight')} {fmtMoney(d.legacy.goal.inFlightUsd)}
            </Text>
            <Text size="xs" c="dimmed">
              {t('dashboard.cards.goalPct', { value: fmtNumber((d.legacy.goal.pct ?? 0) * 100) })} ·{' '}
              {t('dashboard.cards.goalPotential', {
                value: fmtNumber((d.legacy.goal.pctPotential ?? 0) * 100),
              })}
            </Text>
          </Paper>
          <Stat
            label={t('dashboard.cards.newPipeline')}
            value={fmtMoney(d.legacy.newPipelineUsd)}
            color="yellow.7"
            to="/oportunidades"
          />
          <Stat
            label={`${t('dashboard.cards.incidents')} · ${t('dashboard.cards.ballInWhale', { count: d.legacy.incidentsBallInWhale })}`}
            value={String(d.legacy.openIncidents)}
            to="/incidentes"
          />
          <Stat
            label={t('dashboard.cards.toInvoice')}
            value={fmtMoney(d.legacy.toInvoice, currency)}
            to="/facturacion"
          />
          <Stat
            label={t('dashboard.cards.toCollect')}
            value={fmtMoney(d.legacy.toCollect, currency)}
            to="/facturacion"
          />
          <Stat
            label={t('dashboard.cards.overdue', { count: d.legacy.overdue.count })}
            value={fmtMoney(d.legacy.overdue.amount, currency)}
            color="red"
            to="/facturacion"
          />
        </SimpleGrid>
      )}
      <Title order={4} mt="sm">
        {t('dashboard.kpisTitle')}
      </Title>
      {!d ? (
        <Skeleton h={300} />
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 5 }} data-testid="kpi-grid">
          {d.kpis.map((k) => (
            <KpiCard key={k.code} k={k} currency={currency} />
          ))}
        </SimpleGrid>
      )}
      {d && (
        <SimpleGrid cols={{ base: 1, lg: 3 }} mt="sm">
          <Paper withBorder p="sm" radius="md">
            <Text size="sm" fw={600} mb="xs">
              {t('dashboard.charts.pipelineByStage', { currency })}
            </Text>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart
                data={d.charts.pipelineByStage.map((s) => ({ ...s, name: String(s.stage) }))}
              >
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="name" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip
                  labelFormatter={(l) => t(`enums:stage.${l}`)}
                  formatter={(v: number) => fmtNumber(v, 2)}
                />
                <Bar
                  isAnimationActive={false}
                  dataKey="amountMm"
                  name={t('fields.amount')}
                  fill="var(--mantine-color-blue-6)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </Paper>
          <Paper withBorder p="sm" radius="md">
            <Text size="sm" fw={600} mb="xs">
              {t('dashboard.charts.funnel', { currency })}
            </Text>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart
                data={d.charts.funnel.map((f) => ({ ...f, name: t(`dashboard.funnel.${f.step}`) }))}
                layout="vertical"
              >
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis type="number" fontSize={11} />
                <YAxis type="category" dataKey="name" width={80} fontSize={11} />
                <Tooltip formatter={(v: number) => fmtNumber(v, 2)} />
                <Bar
                  isAnimationActive={false}
                  dataKey="amountMm"
                  fill="var(--mantine-color-teal-6)"
                  radius={[0, 4, 4, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </Paper>
          <Paper withBorder p="sm" radius="md">
            <Text size="sm" fw={600} mb="xs">
              {t('dashboard.charts.monthly', { currency })}
            </Text>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={d.charts.monthly.map((m) => ({ ...m, name: m.month.slice(5) }))}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="name" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip formatter={(v: number) => fmtNumber(v, 2)} />
                <Legend />
                <Bar
                  isAnimationActive={false}
                  dataKey="ssMm"
                  name={t('dashboard.charts.ss')}
                  fill="var(--mantine-color-indigo-6)"
                />
                <Bar
                  isAnimationActive={false}
                  dataKey="paymentsMm"
                  name={t('dashboard.charts.payments')}
                  fill="var(--mantine-color-green-6)"
                />
              </BarChart>
            </ResponsiveContainer>
          </Paper>
        </SimpleGrid>
      )}
    </Stack>
  );
}
