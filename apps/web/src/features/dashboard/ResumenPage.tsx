import {
  Anchor,
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
import { ExportButtons } from '../../components/ExportButtons';
import { ProcessKpis } from './ProcessKpis';
import { EnumBadge, PageHeader } from '../../components/ui';
import { fmtDateTime, fmtMoney, fmtNumber, fmtPct } from '../../lib/format';
import { scoreColor, useEngagement } from '../health/ClientEngagement';

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
      goalMmCny: number | null;
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
    billing: {
      byYear: {
        year: number;
        invoiced: string;
        invoicedCount: number;
        paid: string;
        pending: string;
        toInvoice: string;
        toInvoiceCount: number;
      }[];
    };
    pipeline: {
      inFlightByStage: { stage: number; count: number; amountUsd: string }[];
      lostThisYear: { count: number; amountUsd: string };
    };
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
  sub,
  color,
  to,
  testId,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  to?: string;
  testId?: string;
}) {
  const inner = (
    <Paper withBorder p="sm" radius="md" h="100%" data-testid={testId}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fz={20} fw={700} c={color}>
        {value}
      </Text>
      {sub && (
        <Text size="xs" c="dimmed">
          {sub}
        </Text>
      )}
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

/** A numbered block of the summary with a link to the page that holds the detail. */
function Section({
  title,
  to,
  testId,
  right,
  children,
}: {
  title: string;
  to?: string;
  testId?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Paper withBorder radius="md" p="md" data-testid={testId}>
      <Group justify="space-between" mb="sm">
        <Title order={4}>{title}</Title>
        <Group gap="sm">
          {right}
          {to && (
            <Anchor component={Link} to={to} size="sm">
              {t('dashboard.sec.seeDetail')} →
            </Anchor>
          )}
        </Group>
      </Group>
      {children}
    </Paper>
  );
}

function GoalSection({ d }: { d: Dashboard }) {
  const { t } = useTranslation();
  const g = d.legacy.goal;
  const pct = (g.pct ?? 0) * 100;
  const potential = (g.pctPotential ?? 0) * 100;
  const gap = g.goalUsd === null ? null : Math.max(0, g.goalUsd - Number(g.closedUsd));
  return (
    <Section
      title={t('dashboard.sec.goal', { year: d.year })}
      to="/oportunidades"
      testId="sec-goal"
      right={
        g.goalUsd !== null && (
          <Text size="sm" c="dimmed">
            {t('dashboard.sec.goalTarget', {
              usd: fmtMoney(String(g.goalUsd)),
              cny: fmtNumber(g.goalMmCny, 0),
            })}
          </Text>
        )
      }
    >
      <Group align="baseline" gap="md" mb={6}>
        <Text fz={34} fw={700} c="green">
          {fmtPct(pct / 100, 1)}
        </Text>
        <Text c="dimmed">{t('dashboard.sec.ofGoal')}</Text>
      </Group>
      <Progress.Root size={18} radius="sm">
        <Progress.Section value={pct} color="green" />
        <Progress.Section value={Math.max(0, potential - pct)} color="blue" />
      </Progress.Root>
      <SimpleGrid cols={{ base: 2, sm: 4 }} mt="md">
        <Stat
          label={t('dashboard.sec.closedYear', { year: d.year })}
          value={fmtMoney(g.closedUsd)}
          color="green"
        />
        <Stat label={t('dashboard.sec.inFlight')} value={fmtMoney(g.inFlightUsd)} color="blue" />
        <Stat
          label={t('dashboard.sec.gap')}
          value={gap === null ? '—' : fmtMoney(String(gap))}
          color="red"
        />
        <Stat
          label={t('dashboard.sec.ifAllCloses')}
          value={fmtPct(potential / 100, 1)}
          sub={t('dashboard.sec.ifAllClosesHint')}
        />
      </SimpleGrid>
    </Section>
  );
}

function BillingSection({ d, currency }: { d: Dashboard; currency: string }) {
  const { t } = useTranslation();
  const l = d.legacy;
  const y = l.billing.byYear.find((b) => b.year === d.year);
  return (
    <Section
      title={t('dashboard.sec.billing', { year: d.year })}
      to="/facturacion"
      testId="sec-billing"
    >
      <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }}>
        <Stat
          label={t('dashboard.sec.invoiced', { year: d.year })}
          value={fmtMoney(y?.invoiced, currency)}
        />
        <Stat
          label={t('dashboard.sec.collected', { year: d.year })}
          value={fmtMoney(y?.paid, currency)}
          color="green"
        />
        <Stat
          label={t('dashboard.cards.toCollect')}
          value={fmtMoney(l.toCollect, currency)}
          color="orange"
        />
        <Stat
          label={t('dashboard.cards.overdue', { count: l.overdue.count })}
          value={fmtMoney(l.overdue.amount, currency)}
          color={Number(l.overdue.amount) > 0 ? 'red' : 'green'}
        />
        <Stat
          label={t('dashboard.sec.dueSoon', { count: l.dueSoon.count })}
          value={fmtMoney(l.dueSoon.amount, currency)}
          color="blue"
        />
        <Stat label={t('dashboard.sec.toInvoice')} value={fmtMoney(l.toInvoice, currency)} />
      </SimpleGrid>
    </Section>
  );
}

interface EdoKpis {
  meta: { lastSyncAt: string | null; totalInCrm: number };
  kpis: {
    open: number;
    whale: number;
    wom: number;
    p12: number;
    breached: number;
    risk: number;
    nofirst: number;
    oldest: { no: string; days: number } | null;
  };
  groups: { ids: string[] }[];
}

function IncidentsSection() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['edo-panel'], queryFn: () => api.get<EdoKpis>('/tickets/edo') });
  const p = q.data;
  if (!p || !p.meta.totalInCrm) return null;
  const k = p.kpis;
  const push = p.groups.reduce((a, g) => a + g.ids.length, 0);
  return (
    <Section
      title={t('dashboard.sec.incidents')}
      to="/incidentes"
      testId="sec-incidents"
      right={
        <Text size="sm" c="dimmed">
          {t('dashboard.sec.edoData', { when: fmtDateTime(p.meta.lastSyncAt) })}
        </Text>
      }
    >
      <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }}>
        <Stat label={t('edo.kpi.open')} value={String(k.open)} color="blue" />
        <Stat label={t('edo.kpi.whaleWom')} value={`${k.whale} / ${k.wom}`} />
        <Stat label={t('edo.kpi.p12')} value={String(k.p12)} color={k.p12 ? 'red' : undefined} />
        <Stat
          label={t('edo.kpi.sla')}
          value={`${k.breached} / ${k.risk}`}
          color={k.breached ? 'red' : undefined}
        />
        <Stat
          label={t('edo.pushTitle')}
          value={String(push)}
          color={push ? 'orange' : undefined}
          sub={t('dashboard.sec.pushHint')}
        />
        <Stat
          label={t('edo.kpi.oldest')}
          value={k.oldest ? `${Math.floor(k.oldest.days)} d` : '—'}
          sub={k.oldest?.no}
        />
      </SimpleGrid>
    </Section>
  );
}

export default function ResumenPage() {
  const { t } = useTranslation();
  const [currency, setCurrency] = useState('USD');
  const q = useQuery({
    queryKey: ['dashboard', currency],
    queryFn: () => api.get<Dashboard>(`/dashboard/kpis?currency=${currency}`),
  });
  const d = q.data;
  const eng = useEngagement().data;
  return (
    <Stack>
      <PageHeader
        title={t('dashboard.title')}
        right={
          <>
            <ExportButtons entity="dashboard" query={`currency=${currency}`} />
            <SegmentedControl
              size="xs"
              value={currency}
              onChange={setCurrency}
              data={['CNY', 'USD', 'CLP']}
              aria-label={t('ui.currency')}
            />
          </>
        }
      />
      <RuleErrors error={q.error} />
      {!d ? (
        <Skeleton h={160} />
      ) : (
        <>
          <GoalSection d={d} />
          <Section title={t('dashboard.sec.pipeline')} to="/oportunidades" testId="sec-pipeline">
            <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }}>
              {d.legacy.pipeline.inFlightByStage.map((s) => (
                <Stat
                  key={s.stage}
                  label={t(`enums:stage.${s.stage}`)}
                  value={fmtMoney(s.amountUsd)}
                  sub={t('dashboard.sec.deals', { count: s.count })}
                />
              ))}
              <Stat
                label={t('dashboard.cards.newPipeline')}
                value={fmtMoney(d.legacy.newPipelineUsd)}
                color="yellow.7"
              />
              <Stat
                label={t('dashboard.sec.lostThisYear', { year: d.year })}
                value={fmtMoney(d.legacy.pipeline.lostThisYear.amountUsd)}
                sub={t('dashboard.sec.deals', { count: d.legacy.pipeline.lostThisYear.count })}
                color="dimmed"
              />
            </SimpleGrid>
          </Section>
          <BillingSection d={d} currency={currency} />
        </>
      )}
      <IncidentsSection />
      {eng && (
        <Section title={t('dashboard.sec.health')} to="/salud" testId="sec-health">
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
            <Stat
              label={t('dashboard.cards.activeTopics')}
              value={String(eng.summary.active)}
              sub={`${eng.summary.healthy} ${t('dashboard.cards.healthy')} · ${eng.summary.atRisk} ${t('dashboard.cards.atRisk')} · ${eng.summary.critical} ${t('dashboard.cards.critical')}`}
            />
            <Stat
              label={t('dashboard.cards.mail30d')}
              value={eng.mailbox ? String(eng.mailbox.emails) : '—'}
              sub={
                eng.mailbox
                  ? t('dashboard.cards.mailDetail', {
                      meetings: eng.mailbox.meetings,
                      upcoming: eng.mailbox.upcoming,
                    })
                  : t('dashboard.cards.noMail')
              }
              testId="card-mail30d"
            />
            <Stat
              label={t('dashboard.cards.staleOnHold')}
              value={`${eng.summary.stale} / ${eng.summary.onHold}`}
              sub={t('dashboard.cards.staleOnHoldHint')}
            />
            <Paper withBorder p="sm" radius="md" h="100%" data-testid="card-client-health">
              <Text size="xs" c="dimmed">
                {t('dashboard.cards.clientHealth')}
              </Text>
              {eng.accounts
                .filter((a) => a.activeCount > 0)
                .slice(0, 5)
                .map((a) => (
                  <Group key={a.accountId} justify="space-between" wrap="nowrap" gap="xs">
                    <Stack gap={0} style={{ minWidth: 0 }}>
                      <Text size="sm" fw={600} truncate>
                        {a.accountName}
                      </Text>
                      <Text size="xs" c="dimmed" truncate>
                        {t('health.clientLine', {
                          active: a.activeCount,
                          total: a.totalCount,
                          emails: a.emails,
                          meetings: a.meetings,
                        })}
                      </Text>
                    </Stack>
                    <Text fw={700} c={scoreColor(a.score)}>
                      {a.score}
                    </Text>
                  </Group>
                ))}
            </Paper>
          </SimpleGrid>
        </Section>
      )}
      <Title order={4} mt="md">
        {t('dashboard.kpisTitle')}
      </Title>
      <Text size="sm" c="dimmed" mt={-8}>
        {t('dashboard.kpisHint')}
      </Text>
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
      <ProcessKpis />
    </Stack>
  );
}
