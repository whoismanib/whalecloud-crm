import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Collapse,
  CopyButton,
  Group,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../../api/client';
import { RuleErrors } from '../../components/RuleErrors';
import { ScrollTable } from '../../components/ui';
import { fmtDateTime } from '../../lib/format';

type KpiKey =
  | 'open'
  | 'whale'
  | 'wom'
  | 'p12'
  | 'breached'
  | 'risk'
  | 'nofirst'
  | 'closed7'
  | 'closed30';

interface Row {
  id: string;
  no: string;
  title: string;
  priority: string | null;
  status: number | null;
  statusName: string;
  org: string;
  side: string;
  assignee: string;
  creator: string;
  coordinator: string;
  created: string | null;
  updated: string | null;
  firstOpr: string | null;
  comment: string;
  link: string;
  open: boolean;
  ball: { who: 'Whale' | 'WOM' | null; label: string };
  ageDays: number | null;
  closedAt: string | null;
  respHours: number | null;
  stale: { lastAct: string | null; hours: number; stale: boolean; days: number | null };
  sla: { state: 'BREACHED' | 'AT_RISK' | 'OK'; src: 'eDo' | 'est'; detail: string } | null;
  reminder: string | null;
}
interface Week {
  label: string;
  created: number;
  closed: number;
  backlog: number;
  respMedian: number | null;
}
interface Panel {
  now: string;
  meta: {
    lastSyncAt: string | null;
    source: string | null;
    totalInCrm: number;
    shown: number;
    closedDays: number;
    sync: { configured: boolean; fixture: boolean };
  };
  kpis: {
    open: number;
    whale: number;
    wom: number;
    byOrg: Record<string, number>;
    p12: number;
    p1WhaleOpen: number;
    breached: number;
    risk: number;
    nofirst: number;
    resp30: { v: number | null; n: number };
    resp30P1: { v: number | null; n: number };
    resp30P2: { v: number | null; n: number };
    closed7: number;
    closed30: number;
    oldest: { no: string; days: number; org: string } | null;
  };
  groups: {
    name: string;
    team: string;
    person: boolean;
    breached: number;
    ids: string[];
    summary: string;
  }[];
  womPending: string[];
  trends: Week[];
  aging: { k: string; Whale: number; WOM: number }[];
  items: Row[];
}
interface SyncStatus {
  busy: boolean;
  progress: { done: number; total: number; label: string } | null;
  lastError: { code: string; message: string; at: string } | null;
  lastOk: {
    at: string;
    mode: string;
    total: number;
    created: number;
    updated: number;
    warning: string | null;
  } | null;
}

const DAY = 86_400_000;
const hours = (h: number | null) => (h == null ? '—' : `${h.toFixed(1)} h`);
const ago = (iso: string | null, now: string, t: TFunction) => {
  if (!iso) return '';
  const min = Math.max(0, Math.round((Date.parse(now) - Date.parse(iso)) / 60_000));
  if (min < 60) return t('edo.agoMin', { count: min });
  if (min < 48 * 60) return t('edo.agoHours', { count: Math.round(min / 60) });
  return t('edo.agoDays', { count: Math.round(min / 1440) });
};

/** Tiny inline line chart (no external chart library, works offline in China). */
function Spark({
  values,
  color = 'var(--mantine-color-blue-6)',
}: {
  values: (number | null)[];
  color?: string;
}) {
  const v = values.map((x) => x ?? 0);
  const max = Math.max(1, ...v);
  const w = 220;
  const h = 34;
  const pts = v.map(
    (x, i) => `${(i / Math.max(1, v.length - 1)) * w},${h - (x / max) * (h - 4) - 2}`,
  );
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} aria-hidden>
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={2} />
    </svg>
  );
}

function Kpi({
  label,
  value,
  sub,
  color,
  active,
  onClick,
  children,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  color?: string;
  active?: boolean;
  onClick?: () => void;
  children?: React.ReactNode;
}) {
  const body = (
    <Card
      withBorder
      padding="md"
      radius="md"
      style={active ? { outline: '2px solid var(--mantine-color-blue-5)' } : undefined}
    >
      <Text size="sm" c="dimmed">
        {label}
      </Text>
      <Text fz={30} fw={600} c={color} lh={1.3}>
        {value}
      </Text>
      {children}
      {sub && (
        <Text size="xs" c="dimmed" mt={4}>
          {sub}
        </Text>
      )}
    </Card>
  );
  return onClick ? (
    <UnstyledButton onClick={onClick} style={{ display: 'block' }}>
      {body}
    </UnstyledButton>
  ) : (
    body
  );
}

const PRIO_COLOR: Record<string, string> = { P1: 'red', P2: 'orange', P3: 'yellow', P4: 'gray' };

function TicketBadges({ r }: { r: Row }) {
  const { t } = useTranslation();
  return (
    <Group gap={6}>
      {r.priority && (
        <Badge color={PRIO_COLOR[r.priority] ?? 'gray'} variant="light">
          {r.priority}
        </Badge>
      )}
      {r.sla && r.sla.state !== 'OK' && (
        <Badge color={r.sla.state === 'BREACHED' ? 'red' : 'yellow'} variant="light">
          {t(`edo.sla.${r.sla.state}`)}
          {r.sla.src === 'est' ? ' ·est' : ''}
        </Badge>
      )}
      {r.stale.stale && (
        <Badge color="red" variant="outline">
          {t('edo.stale')}
        </Badge>
      )}
      <Badge color={r.ball.who === 'WOM' ? 'violet' : 'blue'} variant="dot">
        {t(`edo.ball.${r.ball.label}`)}
      </Badge>
    </Group>
  );
}

function TicketCard({ r }: { r: Row }) {
  const { t } = useTranslation();
  return (
    <Paper withBorder p="sm" radius="md">
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <Stack gap={4} style={{ minWidth: 0 }}>
          <Text fw={500}>
            {r.no} · {r.title}
          </Text>
          <Group gap="xs">
            <TicketBadges r={r} />
            <Text size="sm" c="dimmed">
              {t('edo.ageOpen', { count: Math.floor(r.ageDays ?? 0) })} ·{' '}
              {t('edo.noActivity', { days: (r.stale.days ?? 0).toFixed(1) })}
              {r.coordinator ? ` · ${t('edo.coord')} ${r.coordinator}` : ''}
            </Text>
          </Group>
          {r.comment && (
            <Text size="sm" c="dimmed" lineClamp={1}>
              {r.comment}
            </Text>
          )}
        </Stack>
        <Group gap={4} wrap="nowrap">
          {r.reminder && (
            <CopyButton value={r.reminder}>
              {({ copy, copied }) => (
                <Button
                  size="compact-sm"
                  variant="subtle"
                  onClick={copy}
                  color={copied ? 'green' : undefined}
                >
                  {copied ? t('edo.copied') : t('edo.copyReminder')}
                </Button>
              )}
            </CopyButton>
          )}
          <Button
            component="a"
            href={r.link}
            target="_blank"
            rel="noreferrer"
            size="compact-sm"
            variant="light"
          >
            {t('edo.openInEdo')}
          </Button>
        </Group>
      </Group>
    </Paper>
  );
}

function RefreshButton({ panel }: { panel: Panel }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [polling, setPolling] = useState(false);
  const [startError, setStartError] = useState<unknown>(null);
  const status = useQuery({
    queryKey: ['edo-status'],
    queryFn: () => api.get<SyncStatus>('/tickets/edo/status'),
    refetchInterval: polling ? 1000 : false,
  });
  const s = status.data;
  useEffect(() => {
    if (polling && s && !s.busy) {
      setPolling(false);
      void qc.invalidateQueries({ queryKey: ['edo-panel'] });
      void qc.invalidateQueries({ queryKey: ['tickets'] });
    }
    if (s?.busy && !polling) setPolling(true);
  }, [s, polling, qc]);
  const start = async () => {
    setStartError(null);
    try {
      await api.post('/tickets/edo/refresh', {});
      setPolling(true);
      void status.refetch();
    } catch (e) {
      setStartError(e);
    }
  };
  const busy = polling || !!s?.busy;
  return (
    <Stack gap={4} align="flex-end">
      <Button
        onClick={start}
        loading={busy}
        disabled={!panel.meta.sync.configured}
        data-testid="edo-refresh"
      >
        {t('edo.refresh')}
      </Button>
      {busy && s?.progress && (
        <Text size="xs" c="dimmed">
          {t('edo.progress', {
            done: s.progress.done,
            total: s.progress.total,
            label: s.progress.label,
          })}
        </Text>
      )}
      {!panel.meta.sync.configured && (
        <Text size="xs" c="dimmed" maw={340} ta="right">
          {t('edo.notConfigured')}
        </Text>
      )}
      {!busy && s?.lastError && (
        <Text size="xs" c="red" maw={380} ta="right">
          {s.lastError.message}
        </Text>
      )}
      {!busy && s?.lastOk?.warning && (
        <Text size="xs" c="orange" maw={380} ta="right">
          {s.lastOk.warning}
        </Text>
      )}
      {startError instanceof ApiError && <RuleErrors error={startError} />}
    </Stack>
  );
}

/** Legacy "Incidentes eDo" tab: KPIs, "A quién presionar hoy", waiting on WOM and the table. */
export function EdoPanel() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ['edo-panel'], queryFn: () => api.get<Panel>('/tickets/edo') });
  const [filter, setFilter] = useState<KpiKey | null>(null);
  const [view, setView] = useState<'open' | 'all'>('open');
  const [search, setSearch] = useState('');
  const [showPush, setShowPush] = useState(true);
  const [showWom, setShowWom] = useState(false);
  const p = q.data;
  const byId = useMemo(() => new Map((p?.items ?? []).map((r) => [r.id, r])), [p]);
  if (q.error) return <RuleErrors error={q.error} />;
  if (!p) return null;
  const k = p.kpis;
  const now = Date.parse(p.now);
  const pred: Record<KpiKey, (r: Row) => boolean> = {
    open: (r) => r.open,
    whale: (r) => r.open && r.side === 'Whale',
    wom: (r) => r.open && r.side === 'WOM',
    p12: (r) => r.open && (r.priority === 'P1' || r.priority === 'P2'),
    breached: (r) => r.open && r.sla?.state === 'BREACHED',
    risk: (r) => r.open && r.sla?.state === 'AT_RISK',
    nofirst: (r) => r.open && r.side === 'Whale' && !r.firstOpr,
    closed7: (r) => !!r.closedAt && Date.parse(r.closedAt) >= now - 7 * DAY,
    closed30: (r) => !!r.closedAt && Date.parse(r.closedAt) >= now - 30 * DAY,
  };
  const pick = (key: KpiKey) => {
    setFilter(filter === key ? null : key);
    setView(key === 'closed7' || key === 'closed30' ? 'all' : 'open');
  };
  const s = search.trim().toLowerCase();
  const rows = p.items
    .filter((r) => (filter ? pred[filter](r) : view === 'open' ? r.open : true))
    .filter(
      (r) =>
        !s || `${r.no} ${r.title} ${r.assignee} ${r.org} ${r.creator}`.toLowerCase().includes(s),
    )
    .sort(
      (a, b) =>
        Number(b.open) - Number(a.open) ||
        (a.priority ?? 'P9').localeCompare(b.priority ?? 'P9') ||
        (b.stale.hours ?? 0) - (a.stale.hours ?? 0),
    );
  const orgs = Object.entries(k.byOrg)
    .sort((a, b) => b[1] - a[1])
    .map(([o, n]) => `${o} ${n}`)
    .join(' · ');
  const pushCount = p.groups.reduce((a, g) => a + g.ids.length, 0);
  const wom = p.womPending.map((id) => byId.get(id)).filter((r): r is Row => !!r);

  if (!p.meta.totalInCrm)
    return (
      <Alert color="blue" title={t('edo.emptyTitle')}>
        <Stack gap="xs">
          <Text size="sm">{t('edo.emptyBody')}</Text>
          <Group>
            <RefreshButton panel={p} />
          </Group>
        </Stack>
      </Alert>
    );

  return (
    <Stack data-testid="edo-panel">
      <Group justify="space-between" align="flex-start">
        <div>
          <Title order={2}>{t('edo.title')}</Title>
          <Text size="sm" c="dimmed">
            {t('edo.subtitle', {
              when: fmtDateTime(p.meta.lastSyncAt),
              ago: ago(p.meta.lastSyncAt, p.now, t),
              days: p.meta.closedDays,
              shown: p.meta.shown,
              total: p.meta.totalInCrm,
            })}
          </Text>
        </div>
        <RefreshButton panel={p} />
      </Group>

      <SimpleGrid cols={{ base: 1, xs: 2, md: 3, lg: 6 }}>
        <Kpi
          label={t('edo.kpi.open')}
          value={k.open}
          color="blue"
          active={filter === 'open'}
          onClick={() => pick('open')}
          sub={t('edo.kpi.backlog12')}
        >
          <Spark values={p.trends.map((w) => w.backlog)} />
        </Kpi>
        <Kpi
          label={t('edo.kpi.whaleWom')}
          value={`${k.whale} / ${k.wom}`}
          sub={orgs}
          active={filter === 'whale' || filter === 'wom'}
        >
          <Group gap="xs">
            <Anchor size="sm" onClick={() => pick('whale')}>
              Whale {k.whale}
            </Anchor>
            <Anchor size="sm" c="violet" onClick={() => pick('wom')}>
              WOM {k.wom}
            </Anchor>
          </Group>
        </Kpi>
        <Kpi
          label={t('edo.kpi.p12')}
          value={k.p12}
          color={k.p12 ? 'red' : undefined}
          active={filter === 'p12'}
          onClick={() => pick('p12')}
          sub={t('edo.kpi.p1Whale', { count: k.p1WhaleOpen })}
        />
        <Kpi
          label={t('edo.kpi.sla')}
          value={`${k.breached} / ${k.risk}`}
          color={k.breached ? 'red' : undefined}
          active={filter === 'breached' || filter === 'risk'}
        >
          <Group gap="xs">
            <Anchor size="sm" c="red" onClick={() => pick('breached')}>
              {t('edo.kpi.breached', { count: k.breached })}
            </Anchor>
            <Anchor size="sm" c="orange" onClick={() => pick('risk')}>
              {t('edo.kpi.atRisk', { count: k.risk })}
            </Anchor>
          </Group>
        </Kpi>
        <Kpi
          label={t('edo.kpi.noFirst')}
          value={k.nofirst}
          color={k.nofirst ? 'orange' : undefined}
          active={filter === 'nofirst'}
          onClick={() => pick('nofirst')}
          sub={t('edo.kpi.whaleSide')}
        />
        <Kpi
          label={t('edo.kpi.resp30')}
          value={hours(k.resp30.v)}
          color="blue"
          sub={`P1 ${hours(k.resp30P1.v)} · P2 ${hours(k.resp30P2.v)} · n=${k.resp30.n}`}
        >
          <Spark values={p.trends.map((w) => w.respMedian)} />
        </Kpi>
        <Kpi
          label={t('edo.kpi.closed')}
          value={`${k.closed7} / ${k.closed30}`}
          color="green"
          active={filter === 'closed7' || filter === 'closed30'}
        >
          <Spark values={p.trends.map((w) => w.closed)} color="var(--mantine-color-green-6)" />
          <Group gap="xs">
            <Anchor size="sm" onClick={() => pick('closed7')}>
              {t('edo.kpi.see7')}
            </Anchor>
            <Anchor size="sm" onClick={() => pick('closed30')}>
              {t('edo.kpi.see30')}
            </Anchor>
          </Group>
        </Kpi>
        <Kpi
          label={t('edo.kpi.oldest')}
          value={k.oldest ? `${Math.floor(k.oldest.days)} d` : '—'}
          color={k.oldest && k.oldest.days > 30 ? 'red' : undefined}
          sub={k.oldest ? `${k.oldest.no} · ${k.oldest.org}` : undefined}
        />
      </SimpleGrid>

      <Paper withBorder p="md" radius="md" data-testid="edo-push">
        <Group justify="space-between">
          <UnstyledButton onClick={() => setShowPush((v) => !v)}>
            <Text fw={600}>
              {showPush ? '▾' : '▸'} {t('edo.pushTitle')}
            </Text>
          </UnstyledButton>
          <Text size="sm" c="dimmed">
            {t('edo.pushCount', { tickets: pushCount, people: p.groups.length })}
          </Text>
        </Group>
        <Collapse in={showPush}>
          <Stack mt="sm">
            {!p.groups.length && <Text c="dimmed">{t('edo.pushNone')}</Text>}
            {p.groups.map((g) => (
              <Stack key={g.name} gap="xs">
                <Group justify="space-between">
                  <div>
                    <Text fw={600}>{g.name}</Text>
                    <Text size="sm" c="dimmed">
                      {g.team}
                    </Text>
                  </div>
                  <Group gap="xs">
                    <Badge variant="outline" color="gray">
                      {t('edo.ticketsN', { count: g.ids.length })}
                    </Badge>
                    {g.breached > 0 && (
                      <Badge color="red" variant="light">
                        {t('edo.breachedN', { count: g.breached })}
                      </Badge>
                    )}
                    <CopyButton value={g.summary}>
                      {({ copy, copied }) => (
                        <Button
                          size="compact-sm"
                          variant="default"
                          onClick={copy}
                          color={copied ? 'green' : undefined}
                        >
                          {copied ? t('edo.copied') : t('edo.copyGroup')}
                        </Button>
                      )}
                    </CopyButton>
                  </Group>
                </Group>
                {g.ids
                  .map((id) => byId.get(id))
                  .filter((r): r is Row => !!r)
                  .map((r) => (
                    <TicketCard key={r.id} r={r} />
                  ))}
              </Stack>
            ))}
          </Stack>
        </Collapse>
      </Paper>

      <Paper withBorder p="md" radius="md">
        <Group justify="space-between">
          <UnstyledButton onClick={() => setShowWom((v) => !v)}>
            <Text fw={600}>
              {showWom ? '▾' : '▸'} {t('edo.womTitle')}
            </Text>
          </UnstyledButton>
          <Text size="sm" c="dimmed">
            {t('edo.ticketsN', { count: wom.length })}
          </Text>
        </Group>
        <Collapse in={showWom}>
          <Stack mt="sm">
            {wom.map((r) => (
              <TicketCard key={r.id} r={r} />
            ))}
          </Stack>
        </Collapse>
      </Paper>

      <Paper withBorder p="md" radius="md">
        <Group justify="space-between" mb="sm">
          <Text fw={600}>
            {filter ? t(`edo.filter.${filter}`) : t('edo.tableTitle')} ({rows.length})
          </Text>
          <Group gap="xs">
            {filter && (
              <Button size="compact-sm" variant="subtle" onClick={() => setFilter(null)}>
                {t('edo.clearFilter')}
              </Button>
            )}
            <SegmentedControl
              size="xs"
              value={view}
              onChange={(v) => {
                setView(v as 'open' | 'all');
                setFilter(null);
              }}
              data={[
                { value: 'open', label: t('edo.viewOpen') },
                { value: 'all', label: t('edo.viewAll', { days: p.meta.closedDays }) },
              ]}
            />
            <TextInput
              size="xs"
              placeholder={t('edo.search')}
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
            />
          </Group>
        </Group>
        <ScrollTable minWidth={980} striped data-testid="edo-table">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('edo.col.ticket')}</Table.Th>
              <Table.Th>{t('edo.col.state')}</Table.Th>
              <Table.Th>{t('edo.col.holder')}</Table.Th>
              <Table.Th>{t('edo.col.assignee')}</Table.Th>
              <Table.Th>{t('edo.col.age')}</Table.Th>
              <Table.Th>{t('edo.col.idle')}</Table.Th>
              <Table.Th>{t('edo.col.updated')}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.slice(0, 300).map((r) => (
              <Table.Tr key={r.id}>
                <Table.Td maw={380}>
                  <Text size="sm" fw={500}>
                    {r.no}
                  </Text>
                  <Text size="sm" lineClamp={2}>
                    {r.title}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Stack gap={4}>
                    <TicketBadges r={r} />
                    <Text size="xs" c="dimmed">
                      {r.statusName}
                    </Text>
                  </Stack>
                </Table.Td>
                <Table.Td>{r.org}</Table.Td>
                <Table.Td>{r.assignee}</Table.Td>
                <Table.Td>{r.ageDays == null ? '' : `${Math.floor(r.ageDays)} d`}</Table.Td>
                <Table.Td>
                  {r.open && r.stale.days != null ? `${r.stale.days.toFixed(1)} d` : ''}
                </Table.Td>
                <Table.Td>{fmtDateTime(r.updated)}</Table.Td>
                <Table.Td>
                  <Anchor href={r.link} target="_blank" rel="noreferrer" size="sm">
                    eDo ↗
                  </Anchor>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </ScrollTable>
        {rows.length > 300 && (
          <Text size="xs" c="dimmed" mt="xs">
            {t('edo.truncated', { count: rows.length })}
          </Text>
        )}
      </Paper>
    </Stack>
  );
}
