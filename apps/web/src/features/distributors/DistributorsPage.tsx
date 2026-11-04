import {
  Badge,
  Button,
  Drawer,
  Group,
  Modal,
  MultiSelect,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { DISTRIBUTOR_STATUSES, VERTICALS } from '@wcrm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { canDo, hasAction, useMe } from '../../auth/useMe';
import { RuleErrors } from '../../components/RuleErrors';
import { PageHeader } from '../../components/ui';
import { fmtDate, fmtMoney, fmtPct, todayIso } from '../../lib/format';
import { useAction } from '../../lib/mutations';
import { opt, useAccountsLite } from '../p2/lookups';

interface Distributor {
  id: string;
  name: string;
  taxId: string | null;
  countryCode: string;
  contactName: string | null;
  status: string;
  agreementOk: boolean;
  agreementEndsOn: string | null;
  pipelineUsd: string;
  wonUsd: string;
}
interface Registration {
  id: string;
  distributorName?: string;
  accountName: string;
  registeredOn: string;
  status: string;
  conflictingOpportunityIds: string[];
  decisionReason: string | null;
  notes: string | null;
}
interface Detail extends Distributor {
  agreements: {
    id: string;
    territories: string[];
    verticals: string[];
    products: string | null;
    marginPct: string;
    startsOn: string;
    endsOn: string;
    status: string;
  }[];
  registrations: Registration[];
  trainings: {
    id: string;
    kind: string;
    heldOn: string;
    product: string | null;
    attendees: string | null;
    notes: string | null;
  }[];
}

const REG_COLOR: Record<string, string> = {
  SUBMITTED: 'blue',
  CONFLICT_REVIEW: 'orange',
  APPROVED: 'green',
  REJECTED: 'red',
  EXPIRED: 'gray',
};

function DistributorDetail({ id }: { id: string }) {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const q = useQuery({
    queryKey: ['distributor', id],
    queryFn: () => api.get<Detail>(`/distributors/${id}`),
  });
  const [ag, setAg] = useState({
    territories: ['CL'],
    verticals: [] as string[],
    products: '',
    marginPct: '0.15',
    startsOn: todayIso(),
    endsOn: '',
  });
  const [tr, setTr] = useState({
    kind: 'TRAINING',
    heldOn: todayIso(),
    product: '',
    attendees: '',
  });
  const inv = { invalidate: [['distributor', id], ['distributors']] };
  const addAg = useAction(
    () => api.post(`/distributors/${id}/agreements`, { ...ag, products: ag.products || null }),
    inv,
  );
  const addTr = useAction(
    () =>
      api.post(`/distributors/${id}/trainings`, {
        ...tr,
        product: tr.product || null,
        attendees: tr.attendees || null,
      }),
    inv,
  );
  const d = q.data;
  if (!d) return null;
  return (
    <Stack data-testid="distributor-detail">
      <Group justify="space-between">
        <Title order={4}>{d.name}</Title>
        <Badge>{t(`p2:distributorStatus.${d.status}`)}</Badge>
      </Group>
      <Text size="sm" c="dimmed">
        {d.countryCode} · {d.contactName ?? '—'}
      </Text>
      <RuleErrors error={addAg.error ?? addTr.error} />
      <Title order={6}>{t('p2:distributor.agreements')}</Title>
      <Table striped>
        <Table.Tbody>
          {d.agreements.map((a) => (
            <Table.Tr key={a.id}>
              <Table.Td>
                {a.territories.join(', ')}
                <Text size="xs" c="dimmed">
                  {a.verticals.map((v) => t(`enums:vertical.${v}`)).join(', ')}
                </Text>
              </Table.Td>
              <Table.Td>{a.products}</Table.Td>
              <Table.Td>{fmtPct(a.marginPct)}</Table.Td>
              <Table.Td>
                {fmtDate(a.startsOn)} → {fmtDate(a.endsOn)}
              </Table.Td>
              <Table.Td>
                <Badge
                  size="xs"
                  color={a.status === 'ACTIVE' && a.endsOn >= todayIso() ? 'green' : 'gray'}
                >
                  {a.endsOn < todayIso() ? t('p2:distributor.expired') : a.status}
                </Badge>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {canDo(me, 'P13', 'approve') && (
        <Paper withBorder p="sm">
          <SimpleGrid cols={3}>
            <MultiSelect
              size="xs"
              label={t('p2:distributor.territories')}
              data={['CL', 'PE', 'CO', 'MX', 'AR', 'BR', 'EC', 'UY']}
              value={ag.territories}
              onChange={(v) => setAg({ ...ag, territories: v })}
            />
            <MultiSelect
              size="xs"
              label={t('fields.vertical')}
              data={VERTICALS.map((v) => ({ value: v, label: t(`enums:vertical.${v}`) }))}
              value={ag.verticals}
              onChange={(v) => setAg({ ...ag, verticals: v })}
            />
            <TextInput
              size="xs"
              label={t('p2:distributor.margin')}
              value={ag.marginPct}
              onChange={(e) => setAg({ ...ag, marginPct: e.currentTarget.value })}
            />
            <TextInput
              size="xs"
              label={t('p2:distributor.products')}
              value={ag.products}
              onChange={(e) => setAg({ ...ag, products: e.currentTarget.value })}
            />
            <TextInput
              size="xs"
              type="date"
              label={t('p2:distributor.startsOn')}
              value={ag.startsOn}
              onChange={(e) => setAg({ ...ag, startsOn: e.currentTarget.value })}
            />
            <TextInput
              size="xs"
              type="date"
              label={t('p2:distributor.endsOn')}
              value={ag.endsOn}
              onChange={(e) => setAg({ ...ag, endsOn: e.currentTarget.value })}
            />
          </SimpleGrid>
          <Button size="xs" mt="xs" onClick={() => addAg.mutate(undefined)}>
            {t('p2:distributor.addAgreement')}
          </Button>
        </Paper>
      )}
      <Title order={6}>{t('p2:distributor.trainings')}</Title>
      {d.trainings.map((x) => (
        <Text key={x.id} size="sm">
          <Badge size="xs" variant="light" mr={4}>
            {t(`p2:trainingKind.${x.kind}`)}
          </Badge>
          {fmtDate(x.heldOn)} · {x.product} · {x.attendees}
        </Text>
      ))}
      {canDo(me, 'P13', 'write') && (
        <Paper withBorder p="sm">
          <SimpleGrid cols={4}>
            <Select
              size="xs"
              label={t('fields.type')}
              data={['TRAINING', 'DEMO'].map((k) => ({
                value: k,
                label: t(`p2:trainingKind.${k}`),
              }))}
              value={tr.kind}
              onChange={(v) => v && setTr({ ...tr, kind: v })}
            />
            <TextInput
              size="xs"
              type="date"
              label={t('fields.date')}
              value={tr.heldOn}
              onChange={(e) => setTr({ ...tr, heldOn: e.currentTarget.value })}
            />
            <TextInput
              size="xs"
              label={t('p2:distributor.product')}
              value={tr.product}
              onChange={(e) => setTr({ ...tr, product: e.currentTarget.value })}
            />
            <TextInput
              size="xs"
              label={t('p2:distributor.attendees')}
              value={tr.attendees}
              onChange={(e) => setTr({ ...tr, attendees: e.currentTarget.value })}
            />
          </SimpleGrid>
          <Button size="xs" mt="xs" onClick={() => addTr.mutate(undefined)}>
            {t('actions.add')}
          </Button>
        </Paper>
      )}
    </Stack>
  );
}

function NewDistributor({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [v, setV] = useState({
    name: '',
    taxId: '',
    countryCode: 'CL',
    contactName: '',
    status: 'PROSPECT',
  });
  const m = useAction(
    () =>
      api.post('/distributors', {
        ...v,
        taxId: v.taxId || null,
        contactName: v.contactName || null,
      }),
    {
      invalidate: [['distributors']],
      onDone,
    },
  );
  return (
    <Stack>
      <TextInput
        label={t('fields.name')}
        value={v.name}
        onChange={(e) => setV({ ...v, name: e.currentTarget.value })}
      />
      <TextInput
        label={t('fields.taxId')}
        value={v.taxId}
        onChange={(e) => setV({ ...v, taxId: e.currentTarget.value })}
      />
      <TextInput
        label={t('fields.country')}
        value={v.countryCode}
        onChange={(e) => setV({ ...v, countryCode: e.currentTarget.value.toUpperCase() })}
      />
      <TextInput
        label={t('fields.contact')}
        value={v.contactName}
        onChange={(e) => setV({ ...v, contactName: e.currentTarget.value })}
      />
      <Select
        label={t('fields.status')}
        data={DISTRIBUTOR_STATUSES.map((s) => ({
          value: s,
          label: t(`p2:distributorStatus.${s}`),
        }))}
        value={v.status}
        onChange={(x) => x && setV({ ...v, status: x })}
      />
      <RuleErrors error={m.error} />
      <Button onClick={() => m.mutate(undefined)}>{t('actions.create')}</Button>
    </Stack>
  );
}

function NewRegistration({
  distributors,
  onDone,
}: {
  distributors: Distributor[];
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const accounts = useAccountsLite();
  const [v, setV] = useState({
    distributorId: '',
    accountId: '',
    registeredOn: todayIso(),
    notes: '',
  });
  const m = useAction(() => api.post('/deal-registrations', { ...v, notes: v.notes || null }), {
    invalidate: [['registrations'], ['distributors']],
    onDone,
  });
  return (
    <Stack>
      <Select
        label={t('p2:distributor.distributor')}
        data={opt(distributors)}
        value={v.distributorId || null}
        onChange={(x) => setV({ ...v, distributorId: x ?? '' })}
      />
      <Select
        label={t('fields.account')}
        searchable
        data={opt(accounts.data)}
        value={v.accountId || null}
        onChange={(x) => setV({ ...v, accountId: x ?? '' })}
      />
      <TextInput
        type="date"
        label={t('fields.date')}
        value={v.registeredOn}
        onChange={(e) => setV({ ...v, registeredOn: e.currentTarget.value })}
      />
      <Textarea
        label={t('fields.notes')}
        value={v.notes}
        onChange={(e) => setV({ ...v, notes: e.currentTarget.value })}
      />
      <RuleErrors error={m.error} />
      <Button onClick={() => m.mutate(undefined)}>{t('p2:distributor.register')}</Button>
    </Stack>
  );
}

/** P13: distributors — agreement (territory, margin), deal registration with channel-conflict check, trainings. */
export default function DistributorsPage() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const [selected, setSelected] = useState<string | null>(null);
  const [modal, setModal] = useState<'dist' | 'reg' | null>(null);
  const [reason, setReason] = useState<Record<string, string>>({});
  const q = useQuery({
    queryKey: ['distributors'],
    queryFn: () => api.get<Distributor[]>('/distributors'),
  });
  const regs = useQuery({
    queryKey: ['registrations'],
    queryFn: () => api.get<Registration[]>('/deal-registrations'),
  });
  const decide = useAction(
    ({ id, status }: { id: string; status: 'APPROVED' | 'REJECTED' }) =>
      api.post(`/deal-registrations/${id}/decision`, { status, reason: reason[id] ?? '' }),
    { invalidate: [['registrations']] },
  );
  const canWrite = canDo(me, 'P13', 'write');
  return (
    <Stack>
      <PageHeader
        title={t('p2:distributor.title')}
        right={
          canWrite && (
            <>
              <Button size="xs" variant="default" onClick={() => setModal('reg')}>
                {t('p2:distributor.newRegistration')}
              </Button>
              <Button size="xs" onClick={() => setModal('dist')}>
                {t('p2:distributor.new')}
              </Button>
            </>
          )
        }
      />
      <RuleErrors error={q.error ?? decide.error} />
      <Table striped highlightOnHover withTableBorder data-testid="distributors-table">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('fields.name')}</Table.Th>
            <Table.Th>{t('fields.status')}</Table.Th>
            <Table.Th>{t('p2:distributor.agreement')}</Table.Th>
            <Table.Th>{t('p2:distributor.pipeline')}</Table.Th>
            <Table.Th>{t('p2:distributor.won')}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {(q.data ?? []).map((d) => (
            <Table.Tr key={d.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(d.id)}>
              <Table.Td fw={600}>{d.name}</Table.Td>
              <Table.Td>{t(`p2:distributorStatus.${d.status}`)}</Table.Td>
              <Table.Td>
                <Badge color={d.agreementOk ? 'green' : 'red'} variant="light">
                  {d.agreementOk
                    ? t('p2:distributor.valid')
                    : d.agreementEndsOn
                      ? t('p2:distributor.expired')
                      : t('p2:distributor.none')}
                </Badge>{' '}
                {fmtDate(d.agreementEndsOn)}
              </Table.Td>
              <Table.Td>{fmtMoney(d.pipelineUsd)}</Table.Td>
              <Table.Td>{fmtMoney(d.wonUsd)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Title order={5}>{t('p2:distributor.registrations')}</Title>
      <Table striped withTableBorder data-testid="registrations-table">
        <Table.Tbody>
          {(regs.data ?? []).map((r) => (
            <Table.Tr key={r.id}>
              <Table.Td>
                {r.distributorName} → {r.accountName}
                <Text size="xs" c="dimmed">
                  {fmtDate(r.registeredOn)} · {r.notes}
                </Text>
              </Table.Td>
              <Table.Td>
                <Badge color={REG_COLOR[r.status]}>{t(`p2:registrationStatus.${r.status}`)}</Badge>
                {r.conflictingOpportunityIds.length > 0 && (
                  <Text size="xs" c="orange">
                    {t('p2:distributor.conflicts', { count: r.conflictingOpportunityIds.length })}
                  </Text>
                )}
                {r.decisionReason && <Text size="xs">{r.decisionReason}</Text>}
              </Table.Td>
              <Table.Td>
                {['SUBMITTED', 'CONFLICT_REVIEW'].includes(r.status) &&
                  hasAction(me, 'P13.conflict.decide') && (
                    <Group gap={4}>
                      <TextInput
                        size="xs"
                        placeholder={t('fields.reason')}
                        value={reason[r.id] ?? ''}
                        onChange={(e) => {
                          const v = e.currentTarget.value;
                          setReason((x) => ({ ...x, [r.id]: v }));
                        }}
                      />
                      <Button
                        size="compact-xs"
                        color="green"
                        onClick={() => decide.mutate({ id: r.id, status: 'APPROVED' })}
                      >
                        {t('actions.approve')}
                      </Button>
                      <Button
                        size="compact-xs"
                        color="red"
                        variant="light"
                        onClick={() => decide.mutate({ id: r.id, status: 'REJECTED' })}
                      >
                        {t('actions.reject')}
                      </Button>
                    </Group>
                  )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Drawer
        opened={Boolean(selected)}
        onClose={() => setSelected(null)}
        position="right"
        size="xl"
      >
        {selected && <DistributorDetail id={selected} />}
      </Drawer>
      <Modal
        opened={modal !== null}
        onClose={() => setModal(null)}
        title={modal === 'reg' ? t('p2:distributor.newRegistration') : t('p2:distributor.new')}
      >
        {modal === 'dist' && <NewDistributor onDone={() => setModal(null)} />}
        {modal === 'reg' && (
          <NewRegistration distributors={q.data ?? []} onDone={() => setModal(null)} />
        )}
      </Modal>
    </Stack>
  );
}
