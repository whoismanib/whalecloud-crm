import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Drawer,
  Group,
  Modal,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { IconTrash } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { buildRepositoryName, CURRENCIES } from '@wcrm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { canDo, hasAction, useMe } from '../../auth/useMe';
import { RuleErrors } from '../../components/RuleErrors';
import { PageHeader, ScrollTable } from '../../components/ui';
import { fmtDate, fmtMoney, todayIso } from '../../lib/format';
import { useAction } from '../../lib/mutations';
import { opt, useAccountsLite, useContractsLite } from '../p2/lookups';

interface Cr {
  id: string;
  code: string;
  title: string;
  description: string | null;
  status: string;
  accountId: string;
  accountName: string;
  parentTitle: string;
  amount: string | null;
  amountCurrency: string | null;
  opportunityId: string | null;
  poReceivedOn: string | null;
  workStartedOn: string | null;
  receptionOn: string | null;
  cmException: boolean;
  exceptionReason: string | null;
  exceptionExpiresOn: string | null;
  lines?: { id: string; profile: string; hours: string; rate: string; amount: string }[];
}
interface RateCard {
  id: string;
  accountName: string | null;
  contractTitle: string | null;
  profile: string;
  rate: string;
  currency: string;
  unit: string;
  validFrom: string;
  validTo: string | null;
}

const STATUS_COLOR: Record<string, string> = {
  DRAFT: 'gray',
  QUOTED: 'blue',
  PO_RECEIVED: 'teal',
  IN_PROGRESS: 'yellow',
  RECEIVED: 'green',
  INVOICED: 'green',
  CANCELLED: 'gray',
};

function docName(client: string, kind: 'OC' | 'REC', number: string, date: string) {
  try {
    return buildRepositoryName({
      country: 'CL',
      client,
      type: kind,
      number,
      version: 1,
      date,
      ext: 'pdf',
    });
  } catch {
    return '';
  }
}

function CrDetail({ id }: { id: string }) {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const q = useQuery({
    queryKey: ['cr', id],
    queryFn: () => api.get<Cr>(`/change-requests/${id}`),
  });
  const [lines, setLines] = useState<{ profile: string; hours: string }[] | null>(null);
  const [po, setPo] = useState({ poNumber: '', poReceivedOn: todayIso(), url: '' });
  const [exc, setExc] = useState({ reason: '', expiresOn: '' });
  const [rec, setRec] = useState({ receptionOn: todayIso(), url: '' });
  const inv = { invalidate: [['cr', id], ['crs'], ['work-without-po']] };
  const saveLines = useAction(() => api.put(`/change-requests/${id}/lines`, lines), {
    ...inv,
    onDone: () => setLines(null),
  });
  const sendPo = useAction(
    () =>
      api.post(`/change-requests/${id}/po`, {
        ...po,
        standardName: docName(c!.accountName, 'OC', po.poNumber, po.poReceivedOn),
      }),
    inv,
  );
  const exception = useAction(() => api.post(`/change-requests/${id}/exception`, exc), inv);
  const start = useAction(() => api.post(`/change-requests/${id}/start-work`), inv);
  const reception = useAction(
    () =>
      api.post(`/change-requests/${id}/reception`, {
        ...rec,
        standardName: docName(c!.accountName, 'REC', c!.code, rec.receptionOn),
      }),
    inv,
  );
  const c = q.data;
  if (!c) return null;
  const canWrite = canDo(me, 'P11', 'write');
  const editLines = lines ?? (c.lines ?? []).map((l) => ({ profile: l.profile, hours: l.hours }));
  const err =
    saveLines.error ?? sendPo.error ?? exception.error ?? start.error ?? reception.error ?? q.error;
  return (
    <Stack data-testid="cr-detail">
      <Group justify="space-between">
        <Title order={4}>
          {c.code} · {c.title}
        </Title>
        <Badge color={STATUS_COLOR[c.status]}>{t(`p2:crStatus.${c.status}`)}</Badge>
      </Group>
      <Text size="sm" c="dimmed">
        {c.accountName} · {c.parentTitle}
      </Text>
      {c.description && <Text size="sm">{c.description}</Text>}
      {c.cmException && (
        <Alert color="orange" title={t('p2:cr.exceptionActive')} data-testid="cr-exception">
          {c.exceptionReason} · {t('p2:cr.expiresOn')}: {fmtDate(c.exceptionExpiresOn)}
        </Alert>
      )}
      <RuleErrors error={err} />
      <Paper withBorder p="sm">
        <Title order={6}>{t('p2:cr.lines')}</Title>
        <ScrollTable>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('p2:cr.profile')}</Table.Th>
              <Table.Th>{t('p2:cr.hours')}</Table.Th>
              <Table.Th>{t('p2:cr.rate')}</Table.Th>
              <Table.Th>{t('fields.amount')}</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {editLines.map((l, i) => {
              const saved = lines ? undefined : c.lines?.[i];
              return (
                <Table.Tr key={i}>
                  <Table.Td>
                    <TextInput
                      size="xs"
                      disabled={!canWrite || !['DRAFT', 'QUOTED'].includes(c.status)}
                      value={l.profile}
                      onChange={(e) => {
                        const v = e.currentTarget.value;
                        setLines(editLines.map((x, j) => (j === i ? { ...x, profile: v } : x)));
                      }}
                    />
                  </Table.Td>
                  <Table.Td>
                    <TextInput
                      size="xs"
                      w={90}
                      disabled={!canWrite || !['DRAFT', 'QUOTED'].includes(c.status)}
                      value={l.hours}
                      onChange={(e) => {
                        const v = e.currentTarget.value;
                        setLines(editLines.map((x, j) => (j === i ? { ...x, hours: v } : x)));
                      }}
                    />
                  </Table.Td>
                  <Table.Td>
                    {saved ? fmtMoney(saved.rate, c.amountCurrency ?? 'USD') : '—'}
                  </Table.Td>
                  <Table.Td>
                    {saved ? fmtMoney(saved.amount, c.amountCurrency ?? 'USD') : '—'}
                  </Table.Td>
                  <Table.Td>
                    {canWrite && ['DRAFT', 'QUOTED'].includes(c.status) && (
                      <ActionIcon
                        size="sm"
                        variant="subtle"
                        color="red"
                        aria-label="remove"
                        onClick={() => setLines(editLines.filter((_, j) => j !== i))}
                      >
                        <IconTrash size={14} />
                      </ActionIcon>
                    )}
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </ScrollTable>
        <Group justify="space-between" mt="xs">
          <Text fw={600}>
            {t('ui.total')}: {fmtMoney(c.amount, c.amountCurrency ?? 'USD')}
          </Text>
          {canWrite && ['DRAFT', 'QUOTED'].includes(c.status) && (
            <Group gap="xs">
              <Button
                size="xs"
                variant="default"
                onClick={() => setLines([...editLines, { profile: '', hours: '' }])}
              >
                {t('actions.add')}
              </Button>
              <Button size="xs" onClick={() => saveLines.mutate(undefined)} disabled={!lines}>
                {t('p2:cr.quote')}
              </Button>
            </Group>
          )}
        </Group>
        <Text size="xs" c="dimmed" mt={4}>
          {t('p2:cr.rateHint')}
        </Text>
      </Paper>
      {canWrite && ['QUOTED', 'IN_PROGRESS'].includes(c.status) && !c.poReceivedOn && (
        <Paper withBorder p="sm">
          <Title order={6}>{t('p2:cr.po')}</Title>
          <SimpleGrid cols={3}>
            <TextInput
              size="xs"
              label={t('p2:cr.poNumber')}
              value={po.poNumber}
              onChange={(e) => setPo({ ...po, poNumber: e.currentTarget.value })}
            />
            <TextInput
              size="xs"
              type="date"
              label={t('fields.date')}
              value={po.poReceivedOn}
              onChange={(e) => setPo({ ...po, poReceivedOn: e.currentTarget.value })}
            />
            <TextInput
              size="xs"
              label="URL"
              placeholder="https://"
              value={po.url}
              onChange={(e) => setPo({ ...po, url: e.currentTarget.value })}
            />
          </SimpleGrid>
          <Text size="xs" c="dimmed" mt={4}>
            {docName(c.accountName, 'OC', po.poNumber || 'NA', po.poReceivedOn)}
          </Text>
          <Button size="xs" mt="xs" onClick={() => sendPo.mutate(undefined)}>
            {t('p2:cr.registerPo')}
          </Button>
        </Paper>
      )}
      {c.status === 'QUOTED' && !c.cmException && hasAction(me, 'P11.exception') && (
        <Paper withBorder p="sm">
          <Title order={6}>{t('p2:cr.exception')}</Title>
          <SimpleGrid cols={2}>
            <Textarea
              size="xs"
              label={t('fields.reason')}
              value={exc.reason}
              onChange={(e) => setExc({ ...exc, reason: e.currentTarget.value })}
            />
            <TextInput
              size="xs"
              type="date"
              label={t('p2:cr.expiresOn')}
              value={exc.expiresOn}
              onChange={(e) => setExc({ ...exc, expiresOn: e.currentTarget.value })}
            />
          </SimpleGrid>
          <Button size="xs" mt="xs" color="orange" onClick={() => exception.mutate(undefined)}>
            {t('p2:cr.grantException')}
          </Button>
        </Paper>
      )}
      <Group>
        {canWrite && ['QUOTED', 'PO_RECEIVED'].includes(c.status) && (
          <Button size="xs" onClick={() => start.mutate(undefined)} data-testid="cr-start">
            {t('p2:cr.startWork')}
          </Button>
        )}
        {c.opportunityId && (
          <Anchor component={Link} to={`/oportunidades/${c.opportunityId}`} size="sm">
            {t('p2:cr.opportunity')}
          </Anchor>
        )}
      </Group>
      {canWrite && ['IN_PROGRESS', 'PO_RECEIVED'].includes(c.status) && (
        <Paper withBorder p="sm">
          <Title order={6}>{t('p2:cr.reception')}</Title>
          <SimpleGrid cols={2}>
            <TextInput
              size="xs"
              type="date"
              label={t('fields.date')}
              value={rec.receptionOn}
              onChange={(e) => setRec({ ...rec, receptionOn: e.currentTarget.value })}
            />
            <TextInput
              size="xs"
              label="URL"
              placeholder="https://"
              value={rec.url}
              onChange={(e) => setRec({ ...rec, url: e.currentTarget.value })}
            />
          </SimpleGrid>
          <Button size="xs" mt="xs" onClick={() => reception.mutate(undefined)}>
            {t('p2:cr.registerReception')}
          </Button>
        </Paper>
      )}
    </Stack>
  );
}

function NewCr({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const contracts = useContractsLite();
  const [v, setV] = useState({ parentContractId: '', title: '', description: '' });
  const m = useAction(
    () => api.post('/change-requests', { ...v, description: v.description || null }),
    {
      invalidate: [['crs']],
      onDone,
    },
  );
  return (
    <Stack>
      <Select
        label={t('p2:cr.parentContract')}
        searchable
        data={(contracts.data ?? []).map((c) => ({
          value: c.id,
          label: `${c.accountName} · ${c.title}`,
        }))}
        value={v.parentContractId || null}
        onChange={(x) => setV({ ...v, parentContractId: x ?? '' })}
      />
      <TextInput
        label={t('fields.title')}
        value={v.title}
        onChange={(e) => setV({ ...v, title: e.currentTarget.value })}
      />
      <Textarea
        label={t('p2:cr.description')}
        value={v.description}
        onChange={(e) => setV({ ...v, description: e.currentTarget.value })}
      />
      <RuleErrors error={m.error} />
      <Button onClick={() => m.mutate(undefined)}>{t('actions.create')}</Button>
    </Stack>
  );
}

function RateCards() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const q = useQuery({
    queryKey: ['rate-cards'],
    queryFn: () => api.get<RateCard[]>('/rate-cards'),
  });
  const accounts = useAccountsLite();
  const [v, setV] = useState({
    accountId: '',
    profile: '',
    rate: '',
    currency: 'USD',
    validFrom: todayIso(),
  });
  const m = useAction(() => api.post('/rate-cards', { ...v, accountId: v.accountId || null }), {
    invalidate: [['rate-cards']],
    onDone: () => setV({ ...v, profile: '', rate: '' }),
  });
  return (
    <Stack>
      <ScrollTable striped withTableBorder data-testid="rate-cards">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('p2:cr.scope')}</Table.Th>
            <Table.Th>{t('p2:cr.profile')}</Table.Th>
            <Table.Th>{t('p2:cr.rate')}</Table.Th>
            <Table.Th>{t('p2:cr.validity')}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {(q.data ?? []).map((r) => (
            <Table.Tr key={r.id}>
              <Table.Td>{r.contractTitle ?? r.accountName ?? t('p2:cr.global')}</Table.Td>
              <Table.Td>{r.profile}</Table.Td>
              <Table.Td>
                {fmtMoney(r.rate, r.currency)} / {r.unit}
              </Table.Td>
              <Table.Td>
                {fmtDate(r.validFrom)} → {fmtDate(r.validTo)}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </ScrollTable>
      {canDo(me, 'P11', 'write') && (
        <Paper withBorder p="sm">
          <SimpleGrid cols={{ base: 2, md: 5 }}>
            <Select
              size="xs"
              clearable
              label={t('fields.account')}
              data={opt(accounts.data)}
              value={v.accountId || null}
              onChange={(x) => setV({ ...v, accountId: x ?? '' })}
            />
            <TextInput
              size="xs"
              label={t('p2:cr.profile')}
              value={v.profile}
              onChange={(e) => setV({ ...v, profile: e.currentTarget.value })}
            />
            <TextInput
              size="xs"
              label={t('p2:cr.rate')}
              value={v.rate}
              onChange={(e) => setV({ ...v, rate: e.currentTarget.value })}
            />
            <Select
              size="xs"
              label={t('fields.currency')}
              data={[...CURRENCIES]}
              value={v.currency}
              onChange={(x) => x && setV({ ...v, currency: x })}
            />
            <TextInput
              size="xs"
              type="date"
              label={t('p2:cr.validFrom')}
              value={v.validFrom}
              onChange={(e) => setV({ ...v, validFrom: e.currentTarget.value })}
            />
          </SimpleGrid>
          <RuleErrors error={m.error} />
          <Button size="xs" mt="xs" onClick={() => m.mutate(undefined)}>
            {t('actions.add')}
          </Button>
        </Paper>
      )}
    </Stack>
  );
}

/** P11: change requests — rate-card quote, client PO, CM exception (audited), reception. */
export default function ChangeRequestsPage() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ['crs'], queryFn: () => api.get<Cr[]>('/change-requests') });
  const noPo = useQuery({
    queryKey: ['work-without-po'],
    queryFn: () => api.get<Cr[]>('/reports/work-without-po'),
  });
  return (
    <Stack>
      <PageHeader
        title={t('p2:cr.title')}
        right={
          canDo(me, 'P11', 'write') && (
            <Button size="xs" onClick={() => setCreating(true)}>
              {t('p2:cr.new')}
            </Button>
          )
        }
      />
      <RuleErrors error={q.error} />
      {(noPo.data ?? []).length > 0 && (
        <Alert color="orange" title={t('p2:cr.workWithoutPo')} data-testid="work-without-po">
          {(noPo.data ?? []).map((c) => (
            <Text key={c.id} size="sm">
              {c.code} · {c.accountName} · {c.title} ·{' '}
              {c.cmException
                ? t('p2:cr.withException', { date: fmtDate(c.exceptionExpiresOn) })
                : t('p2:cr.noException')}
            </Text>
          ))}
        </Alert>
      )}
      <Tabs defaultValue="list">
        <Tabs.List>
          <Tabs.Tab value="list">{t('p2:cr.list')}</Tabs.Tab>
          <Tabs.Tab value="rates">{t('p2:cr.rateCards')}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="list" pt="md">
          <ScrollTable striped highlightOnHover withTableBorder data-testid="crs-table">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('fields.code')}</Table.Th>
                <Table.Th>{t('fields.title')}</Table.Th>
                <Table.Th>{t('fields.account')}</Table.Th>
                <Table.Th>{t('fields.amount')}</Table.Th>
                <Table.Th>{t('fields.status')}</Table.Th>
                <Table.Th>{t('p2:cr.po')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(q.data ?? []).map((c) => (
                <Table.Tr
                  key={c.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setSelected(c.id)}
                >
                  <Table.Td>{c.code}</Table.Td>
                  <Table.Td>{c.title}</Table.Td>
                  <Table.Td>
                    {c.accountName}
                    <Text size="xs" c="dimmed">
                      {c.parentTitle}
                    </Text>
                  </Table.Td>
                  <Table.Td>{fmtMoney(c.amount, c.amountCurrency ?? 'USD')}</Table.Td>
                  <Table.Td>
                    <Badge color={STATUS_COLOR[c.status]}>{t(`p2:crStatus.${c.status}`)}</Badge>
                    {c.cmException && (
                      <Badge ml={4} color="orange" variant="light">
                        {t('p2:cr.exceptionShort')}
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td>{fmtDate(c.poReceivedOn)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </ScrollTable>
        </Tabs.Panel>
        <Tabs.Panel value="rates" pt="md">
          <RateCards />
        </Tabs.Panel>
      </Tabs>
      <Drawer
        opened={Boolean(selected)}
        onClose={() => setSelected(null)}
        position="right"
        size="xl"
      >
        {selected && <CrDetail id={selected} />}
      </Drawer>
      <Modal opened={creating} onClose={() => setCreating(false)} title={t('p2:cr.new')}>
        <NewCr onDone={() => setCreating(false)} />
      </Modal>
    </Stack>
  );
}
