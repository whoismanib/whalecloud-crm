import {
  Button,
  Checkbox,
  Group,
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
import {
  buildRepositoryName,
  CONTRACT_TYPES,
  HANDOFF_CHECKLIST as HANDOFF_CHECKS,
  type ContractType,
  type HandoffChecklistKey as HandoffCheck,
} from '@wcrm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../api/client';
import { useCatalogs } from '../../../api/catalogs';
import { canDo, useMe } from '../../../auth/useMe';
import { RuleErrors } from '../../../components/RuleErrors';
import { EnumBadge } from '../../../components/ui';
import { fmtDate, fmtMoney, todayIso } from '../../../lib/format';
import { useAction } from '../../../lib/mutations';
import type { TabProps } from '../types';

interface Contract {
  id: string;
  type: ContractType;
  number: string | null;
  title: string;
  status: string;
  amount: string | null;
  amountCurrency: string | null;
  signedOn: string | null;
  repositoryUrl: string | null;
  signedStandardName: string | null;
  chinaSystemId: string | null;
}

function SignForm({ c, opp }: { c: Contract } & TabProps) {
  const { t } = useTranslation();
  const [signedOn, setSignedOn] = useState(todayIso());
  const suggested = buildRepositoryName({
    country: opp.countryCode,
    client: opp.account.name,
    type: c.type,
    number: c.number ?? 'NA',
    version: 1,
    date: signedOn,
    ext: 'pdf',
  });
  const [standardName, setStandardName] = useState(suggested);
  const [repositoryUrl, setRepositoryUrl] = useState('https://');
  const [chinaSystemId, setChinaSystemId] = useState('');
  const sign = useAction(
    () =>
      api.post(`/contracts/${c.id}/sign`, { signedOn, standardName, repositoryUrl, chinaSystemId }),
    {
      invalidate: [
        ['contracts', opp.id],
        ['opportunity', opp.id],
      ],
    },
  );
  return (
    <Stack gap={4} mt="xs">
      <SimpleGrid cols={2}>
        <TextInput
          size="xs"
          type="date"
          label={t('contract.signedOn')}
          value={signedOn}
          onChange={(e) => setSignedOn(e.currentTarget.value)}
        />
        <TextInput
          size="xs"
          label={t('fields.chinaSystemId')}
          value={chinaSystemId}
          onChange={(e) => setChinaSystemId(e.currentTarget.value)}
        />
        <TextInput
          size="xs"
          label={t('contract.standardName')}
          description={t('contract.suggested', { name: suggested })}
          value={standardName}
          onChange={(e) => setStandardName(e.currentTarget.value)}
        />
        <TextInput
          size="xs"
          label={t('contract.repositoryUrl')}
          value={repositoryUrl}
          onChange={(e) => setRepositoryUrl(e.currentTarget.value)}
        />
      </SimpleGrid>
      <RuleErrors error={sign.error} />
      <Button size="xs" w="fit-content" onClick={() => sign.mutate(undefined)}>
        {t('contract.sign')}
      </Button>
    </Stack>
  );
}

export function ContractTab({ opp }: TabProps) {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const cat = useCatalogs();
  const list = useQuery({
    queryKey: ['contracts', opp.id],
    queryFn: () => api.get<Contract[]>(`/contracts?opportunityId=${opp.id}`),
  });
  const [type, setType] = useState<string>('SOW');
  const [number, setNumber] = useState('');
  const [title, setTitle] = useState(opp.name);
  const [amount, setAmount] = useState(opp.amount);
  const create = useAction(
    () =>
      api.post('/contracts', {
        accountId: opp.accountId,
        opportunityId: opp.id,
        type,
        number: number || undefined,
        title,
        billingEntityId: cat.data?.billingEntities.find((b) => b.code === 'WC_CL_SPA')?.id,
        billingEngine: opp.billingEngine,
        amount,
        currency: opp.amountCurrency,
      }),
    { invalidate: [['contracts', opp.id]] },
  );
  const fromTc = useAction((id: string) => api.post(`/contracts/${id}/milestones/from-tc`), {
    invalidate: [
      ['milestones', opp.id],
      ['opportunity', opp.id],
    ],
  });
  const [attendees, setAttendees] = useState<string[]>(opp.handoff?.attendeeUserIds ?? []);
  const [zmp, setZmp] = useState(opp.zmpProjectId ?? '');
  const [meetingAt, setMeetingAt] = useState(todayIso());
  const [criteria, setCriteria] = useState(opp.handoff?.acceptanceCriteria ?? '');
  const [sowUrl, setSowUrl] = useState('');
  const [checks, setChecks] = useState<Record<HandoffCheck, boolean>>(
    () =>
      Object.fromEntries(HANDOFF_CHECKS.map((k) => [k, Boolean(opp.handoff?.[k])])) as Record<
        HandoffCheck,
        boolean
      >,
  );
  const handoff = useAction(
    () =>
      api.post(`/opportunities/${opp.id}/handoff`, {
        attendeeUserIds: attendees,
        zmpProjectId: zmp,
        meetingAt,
        acceptanceCriteria: criteria || null,
        sowUrl: sowUrl || null,
        ...checks,
      }),
    {
      invalidate: [['opportunity', opp.id]],
    },
  );
  const canWrite = canDo(me, 'P7', 'write');
  return (
    <SimpleGrid cols={{ base: 1, lg: 2 }}>
      <Stack>
        <Paper withBorder p="md">
          <Title order={5}>{t('contract.list')}</Title>
          <Table mt="xs">
            <Table.Tbody>
              {(list.data ?? []).map((c) => (
                <Table.Tr key={c.id}>
                  <Table.Td>
                    <Text fw={600}>
                      {t(`enums:contractType.${c.type}`)} {c.number}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {c.title}
                    </Text>
                    {c.signedStandardName && (
                      <Text size="xs">
                        <a href={c.repositoryUrl ?? '#'} target="_blank" rel="noreferrer">
                          {c.signedStandardName}
                        </a>{' '}
                        · {fmtDate(c.signedOn)} · {c.chinaSystemId}
                      </Text>
                    )}
                    {canWrite && ['DRAFT', 'IN_LEGAL_REVIEW'].includes(c.status) && (
                      <SignForm c={c} opp={opp} />
                    )}
                    {canWrite && ['SIGNED', 'ACTIVE'].includes(c.status) && opp.stage >= 7 && (
                      <Button size="xs" variant="light" mt={4} onClick={() => fromTc.mutate(c.id)}>
                        {t('contract.fromTc')}
                      </Button>
                    )}
                  </Table.Td>
                  <Table.Td>{fmtMoney(c.amount, c.amountCurrency ?? 'USD')}</Table.Td>
                  <Table.Td>
                    <EnumBadge ns="contractStatus" value={c.status} />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          <RuleErrors error={fromTc.error} />
        </Paper>
        {canWrite && (
          <Paper withBorder p="md">
            <Title order={5}>{t('contract.new')}</Title>
            <SimpleGrid cols={2} mt="xs">
              <Select
                size="xs"
                label={t('fields.type')}
                data={CONTRACT_TYPES.map((x) => ({
                  value: x,
                  label: t(`enums:contractType.${x}`),
                }))}
                value={type}
                onChange={(v) => setType(v ?? 'SOW')}
              />
              <TextInput
                size="xs"
                label={t('fields.number')}
                value={number}
                onChange={(e) => setNumber(e.currentTarget.value)}
              />
              <TextInput
                size="xs"
                label={t('fields.title')}
                value={title}
                onChange={(e) => setTitle(e.currentTarget.value)}
              />
              <TextInput
                size="xs"
                label={`${t('fields.amount')} (${opp.amountCurrency})`}
                value={amount}
                onChange={(e) => setAmount(e.currentTarget.value)}
              />
            </SimpleGrid>
            <RuleErrors error={create.error} />
            <Button size="xs" mt="xs" onClick={() => create.mutate(undefined)}>
              {t('actions.create')}
            </Button>
          </Paper>
        )}
      </Stack>
      {opp.stage >= 7 && canDo(me, 'P9', 'write') && (
        <Paper withBorder p="md">
          <Title order={5}>{t('contract.handoff')}</Title>
          <Stack gap="xs" mt="xs">
            <TextInput
              size="xs"
              type="date"
              label={t('contract.meetingAt')}
              value={meetingAt}
              onChange={(e) => setMeetingAt(e.currentTarget.value)}
            />
            <MultiSelect
              size="xs"
              label={t('contract.attendees')}
              data={(cat.data?.users ?? []).map((u) => ({
                value: u.id,
                label: `${u.fullName} · ${u.roles.map((r) => t(`enums:role.${r}`)).join(', ')}`,
              }))}
              value={attendees}
              onChange={setAttendees}
            />
            <TextInput
              size="xs"
              label={t('fields.zmpProjectId')}
              value={zmp}
              onChange={(e) => setZmp(e.currentTarget.value)}
            />
            <Textarea
              size="xs"
              autosize
              label={t('p2:handoff.acceptanceCriteria')}
              value={criteria}
              onChange={(e) => setCriteria(e.currentTarget.value)}
            />
            <TextInput
              size="xs"
              label={t('p2:handoff.sowUrl')}
              placeholder="https://"
              value={sowUrl}
              onChange={(e) => setSowUrl(e.currentTarget.value)}
            />
            <Text size="xs" fw={600}>
              {t('p2:handoff.checklist')}
              {opp.handoff?.dueOn
                ? ` · ${t('p2:handoff.dueOn')}: ${fmtDate(opp.handoff.dueOn)}`
                : ''}
            </Text>
            {HANDOFF_CHECKS.map((k) => (
              <Checkbox
                key={k}
                size="xs"
                label={t(`p2:handoff.items.${k}`)}
                checked={checks[k]}
                onChange={(e) => {
                  const v = e.currentTarget.checked;
                  setChecks((c) => ({ ...c, [k]: v }));
                }}
                data-testid={`handoff-${k}`}
              />
            ))}
            <RuleErrors error={handoff.error} />
            <Group>
              <Button size="xs" onClick={() => handoff.mutate(undefined)}>
                {t('actions.save')}
              </Button>
            </Group>
          </Stack>
        </Paper>
      )}
    </SimpleGrid>
  );
}
