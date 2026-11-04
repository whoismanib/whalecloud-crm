import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  List,
  NumberInput,
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
import { zodResolver } from '@hookform/resolvers/zod';
import { IconTrash } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import {
  BILLING_ENGINES,
  COMPETITION_TYPES,
  CURRENCIES,
  MILESTONE_TRIGGERS,
  PriceRequestUpdateSchema,
  RELATIONSHIP_TYPES,
  SIGNING_MODELS,
  sumsTo100,
  type PriceRequestUpdate,
} from '@wcrm/shared';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { api, type ProblemError } from '../../../api/client';
import { canDo, hasAction, useMe } from '../../../auth/useMe';
import { RuleErrors, useRuleMessage } from '../../../components/RuleErrors';
import { EnumBadge, EnumSelect, ScrollTable, useFieldError } from '../../../components/ui';
import { fmtDate } from '../../../lib/format';
import { useAction } from '../../../lib/mutations';
import type { TabProps } from '../types';

interface ExpectedMs {
  seq: number;
  pct: string;
  trigger: string;
  triggerText?: string | null;
}
export interface PriceRequest extends Record<string, unknown> {
  id: string;
  status: string;
  type: string;
  currentHolderRole: string | null;
  slaDueOn: string | null;
  expectedMilestones: ExpectedMs[];
  validation: ProblemError[];
  sla: { status: string; dueDate: string } | null;
  currentSheet: unknown;
}

export function usePriceRequest(id: string | null) {
  return useQuery({
    queryKey: ['priceRequest', id],
    queryFn: () => api.get<PriceRequest>(`/price-requests/${id}`),
    enabled: Boolean(id),
  });
}

const A1_TEXT = [
  'solutionOwnerName',
  'deliveryOwnerName',
  'projectStageLabel',
  'projectLevel',
  'mainCompetitor',
] as const;
const A1_LONG = ['summary', 'strategy', 'risks'] as const;

export function PriceRequestTab({ opp }: TabProps) {
  const { t } = useTranslation();
  const fe = useFieldError();
  const msg = useRuleMessage();
  const { data: me } = useMe();
  const pr = usePriceRequest(opp.currentPriceRequestId);
  const inv = [
    ['opportunity', opp.id],
    ['priceRequest', opp.currentPriceRequestId ?? ''],
  ];
  const canA1 = canDo(me, 'P5', 'write') && hasAction(me, 'P5.a1.write');
  const create = useAction(
    () => api.post(`/opportunities/${opp.id}/price-requests`, { type: 'PROJECT' }),
    { invalidate: inv },
  );
  const form = useForm<PriceRequestUpdate>({ resolver: zodResolver(PriceRequestUpdateSchema) });
  const [ms, setMs] = useState<ExpectedMs[]>([]);
  useEffect(() => {
    if (!pr.data) return;
    const d = pr.data as Record<string, unknown>;
    const vals: Record<string, unknown> = {};
    for (const k of Object.keys(PriceRequestUpdateSchema.shape)) vals[k] = d[k] ?? null;
    form.reset(vals as PriceRequestUpdate);
    setMs(
      pr.data.expectedMilestones.length
        ? pr.data.expectedMilestones
        : [{ seq: 1, pct: '100', trigger: 'SIGNATURE' }],
    );
  }, [pr.data, form]);
  const save = useAction(
    async (v: PriceRequestUpdate) => {
      await api.patch(`/price-requests/${opp.currentPriceRequestId}`, v);
      await api.put(
        `/price-requests/${opp.currentPriceRequestId}/expected-milestones`,
        ms.map((m, i) => ({ ...m, seq: i + 1 })),
      );
    },
    { invalidate: inv },
  );
  const submit = useAction(() => api.post(`/price-requests/${opp.currentPriceRequestId}/submit`), {
    invalidate: [...inv, ['opportunities']],
  });
  const [chinaStatus, setChinaStatus] = useState<string | null>(null);
  const setStatus = useAction(
    () =>
      api.post(`/price-requests/${opp.currentPriceRequestId}/status`, {
        status: chinaStatus,
        holderRole: 'CHINA_SALES',
      }),
    {
      invalidate: inv,
    },
  );

  if (!opp.currentPriceRequestId) {
    return (
      <Stack>
        <Text>{t('pr.none')}</Text>
        {canA1 && (
          <Button
            w="fit-content"
            onClick={() => create.mutate(undefined)}
            loading={create.isPending}
            data-testid="create-pr"
          >
            {t('pr.create')}
          </Button>
        )}
        <RuleErrors error={create.error} />
      </Stack>
    );
  }
  const d = pr.data;
  if (!d) return null;
  const draft = d.status === 'DRAFT';
  const editable = draft && canA1;
  const pctOk = sumsTo100(ms.map((m) => ({ pct: m.pct || '0' })));
  return (
    <Stack>
      <Group>
        <EnumBadge ns="prStatus" value={d.status} />
        {d.currentHolderRole && (
          <Badge variant="outline">
            {t('pr.holder', { role: t(`enums:role.${d.currentHolderRole}`) })}
          </Badge>
        )}
        {d.sla && (
          <Badge
            color={
              d.sla.status === 'OVERDUE' ? 'red' : d.sla.status === 'DUE_SOON' ? 'yellow' : 'blue'
            }
          >
            {t('pr.sla', { date: fmtDate(d.sla.dueDate) })} · {t(`enums:sla.${d.sla.status}`)}
          </Badge>
        )}
      </Group>
      {draft && (
        <Alert
          color={d.validation.length ? 'yellow' : 'green'}
          title={d.validation.length ? t('pr.missing') : t('pr.ready')}
          data-testid="pr-validation"
        >
          <List size="sm">
            {d.validation.map((f, i) => (
              <List.Item key={i}>{msg(f)}</List.Item>
            ))}
          </List>
        </Alert>
      )}
      <form onSubmit={form.handleSubmit((v) => save.mutate(v))}>
        <fieldset disabled={!editable} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <Stack>
            <Paper withBorder p="md">
              <Title order={5} mb="xs">
                {t('pr.a1')}
              </Title>
              <SimpleGrid cols={{ base: 1, md: 3 }}>
                <EnumSelect
                  control={form.control}
                  name="relationshipType"
                  ns="relationship"
                  values={RELATIONSHIP_TYPES}
                  label={t('pr.relationshipType')}
                  disabled={!editable}
                />
                <EnumSelect
                  control={form.control}
                  name="competitionType"
                  ns="competition"
                  values={COMPETITION_TYPES}
                  label={t('pr.competitionType')}
                  disabled={!editable}
                />
                <EnumSelect
                  control={form.control}
                  name="signingModel"
                  ns="signingModel"
                  values={SIGNING_MODELS}
                  label={t('pr.signingModel')}
                  disabled={!editable}
                />
                {A1_TEXT.map((k) => (
                  <TextInput key={k} label={t(`pr.${k}`)} {...form.register(k)} />
                ))}
                <TextInput
                  label={t('pr.budget')}
                  {...form.register('budget')}
                  error={fe(form.formState.errors.budget)}
                />
                <EnumSelect
                  control={form.control}
                  name="currency"
                  ns="none"
                  values={CURRENCIES}
                  label={t('pr.currency')}
                  disabled={!editable}
                />
                <TextInput
                  type="number"
                  label={t('pr.warrantyMonths')}
                  {...form.register('warrantyMonths', {
                    setValueAs: (v) => (v === '' || v === null ? null : Number(v)),
                  })}
                />
              </SimpleGrid>
              <SimpleGrid cols={{ base: 1, md: 3 }} mt="xs">
                {A1_LONG.map((k) => (
                  <Textarea
                    key={k}
                    label={t(`pr.${k}`)}
                    autosize
                    minRows={2}
                    {...form.register(k)}
                  />
                ))}
              </SimpleGrid>
            </Paper>
            <Paper withBorder p="md">
              <Title order={5} mb="xs">
                {t('pr.extra')}
              </Title>
              <SimpleGrid cols={{ base: 1, md: 3 }}>
                <Textarea
                  label={t('pr.scopeSummary')}
                  autosize
                  minRows={2}
                  {...form.register('scopeSummary')}
                />
                <Textarea
                  label={t('pr.assumptions')}
                  autosize
                  minRows={2}
                  {...form.register('assumptions')}
                />
                <Textarea
                  label={t('pr.exclusions')}
                  autosize
                  minRows={2}
                  {...form.register('exclusions')}
                />
                <EnumSelect
                  control={form.control}
                  name="billingEngine"
                  ns="engine"
                  values={BILLING_ENGINES}
                  label={t('pr.billingEngine')}
                  disabled={!editable}
                />
                <TextInput
                  label={t('pr.targetPrice')}
                  {...form.register('targetPrice')}
                  error={fe(form.formState.errors.targetPrice)}
                />
                <TextInput
                  label={t('pr.targetCompetitor')}
                  {...form.register('targetCompetitor')}
                />
              </SimpleGrid>
              <Title order={6} mt="md">
                {t('pr.expectedMilestones')}
              </Title>
              <ScrollTable>
                <Table.Tbody>
                  {ms.map((m, i) => (
                    <Table.Tr key={i}>
                      <Table.Td w={40}>{i + 1}</Table.Td>
                      <Table.Td w={120}>
                        <NumberInput
                          size="xs"
                          suffix=" %"
                          min={0}
                          max={100}
                          value={Number(m.pct)}
                          onChange={(v) =>
                            setMs(ms.map((x, j) => (j === i ? { ...x, pct: String(v) } : x)))
                          }
                        />
                      </Table.Td>
                      <Table.Td>
                        <Select
                          size="xs"
                          data={MILESTONE_TRIGGERS.map((tr) => ({
                            value: tr,
                            label: t(`enums:trigger.${tr}`),
                          }))}
                          value={m.trigger}
                          onChange={(v) =>
                            setMs(ms.map((x, j) => (j === i ? { ...x, trigger: v ?? 'OTHER' } : x)))
                          }
                        />
                      </Table.Td>
                      <Table.Td w={40}>
                        <ActionIcon
                          variant="subtle"
                          color="red"
                          onClick={() => setMs(ms.filter((_, j) => j !== i))}
                        >
                          <IconTrash size={14} />
                        </ActionIcon>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </ScrollTable>
              <Group mt="xs">
                <Button
                  size="xs"
                  variant="default"
                  onClick={() => setMs([...ms, { seq: ms.length + 1, pct: '0', trigger: 'OTHER' }])}
                >
                  {t('pr.addMilestone')}
                </Button>
                <Badge color={pctOk ? 'green' : 'red'}>
                  Σ {ms.reduce((a, m) => a + Number(m.pct || 0), 0)} %
                </Badge>
              </Group>
            </Paper>
          </Stack>
        </fieldset>
        <RuleErrors error={save.error ?? submit.error} />
        {editable && (
          <Group mt="sm">
            <Button type="submit" variant="default" loading={save.isPending}>
              {t('actions.save')}
            </Button>
            {hasAction(me, 'P5.submit') && (
              <Button
                onClick={() => submit.mutate(undefined)}
                loading={submit.isPending}
                data-testid="submit-pr"
              >
                {t('actions.submit')}
              </Button>
            )}
          </Group>
        )}
      </form>
      {!draft && hasAction(me, 'P5.status') && !['APPROVED', 'CANCELLED'].includes(d.status) && (
        <Group>
          <Select
            size="xs"
            label={t('pr.chinaStatus')}
            data={['COSTING', 'BUILDING', 'READY_FOR_APPROVAL'].map((s) => ({
              value: s,
              label: t(`enums:prStatus.${s}`),
            }))}
            value={chinaStatus}
            onChange={setChinaStatus}
          />
          <Button
            size="xs"
            mt={22}
            onClick={() => setStatus.mutate(undefined)}
            disabled={!chinaStatus}
          >
            {t('actions.save')}
          </Button>
          <RuleErrors error={setStatus.error} />
        </Group>
      )}
    </Stack>
  );
}
