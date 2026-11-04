import {
  Badge,
  Button,
  Card,
  Group,
  Modal,
  ScrollArea,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import {
  BILLING_ENGINES,
  CURRENCIES,
  FORECAST_CATEGORIES,
  LEAD_ORIGINS,
  OpportunityCreateSchema,
  RISK_LEVELS,
  VERTICALS,
  type OpportunityCreate,
} from '@wcrm/shared';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { canDo, useMe } from '../../auth/useMe';
import { RuleErrors } from '../../components/RuleErrors';
import { ExportButtons } from '../../components/ExportButtons';
import { EnumBadge, EnumSelect, PageHeader, StageBadge, useFieldError } from '../../components/ui';
import { fmtDate, fmtMoney, todayIso } from '../../lib/format';
import { useAction } from '../../lib/mutations';

export interface OppRow {
  id: string;
  code: string;
  name: string;
  accountName: string;
  ownerName: string;
  stage: number;
  status: string;
  amount: string;
  amountCurrency: string;
  amountUsd: string;
  expectedCloseDate: string;
  billingEngine: string;
  forecastCategory: string | null;
  risk: string | null;
  registeredLate: boolean;
}

function CreateOpportunity({ onDone }: { onDone: (id: string) => void }) {
  const { t } = useTranslation();
  const fe = useFieldError();
  const accounts = useQuery({
    queryKey: ['accounts', ''],
    queryFn: () => api.get<{ id: string; name: string; vertical: string }[]>('/accounts'),
  });
  const form = useForm<OpportunityCreate>({
    resolver: zodResolver(OpportunityCreateSchema),
    defaultValues: {
      countryCode: 'CL',
      currency: 'USD',
      firstContactDate: todayIso(),
      origin: 'REFERRAL',
    },
  });
  const accountId = form.watch('accountId');
  const contacts = useQuery({
    queryKey: ['account', accountId, 'contacts'],
    queryFn: () =>
      api.get<{ id: string; firstName: string; lastName: string }[]>(
        `/accounts/${accountId}/contacts`,
      ),
    enabled: Boolean(accountId),
  });
  const m = useAction((v: OpportunityCreate) => api.post<{ id: string }>('/opportunities', v), {
    invalidate: [['opportunities']],
    onDone: (r) => onDone(r.id),
  });
  return (
    <form onSubmit={form.handleSubmit((v) => m.mutate(v))}>
      <Stack>
        <TextInput
          label={t('fields.name')}
          {...form.register('name')}
          error={fe(form.formState.errors.name)}
        />
        <SimpleGrid cols={2}>
          <Controller
            control={form.control}
            name="accountId"
            render={({ field, fieldState }) => (
              <Select
                searchable
                label={t('fields.account')}
                data={(accounts.data ?? []).map((a) => ({ value: a.id, label: a.name }))}
                value={field.value ?? null}
                onChange={(v) => {
                  field.onChange(v);
                  const acc = accounts.data?.find((a) => a.id === v);
                  if (acc) form.setValue('vertical', acc.vertical as OpportunityCreate['vertical']);
                }}
                error={fieldState.error ? t('errors:validation.REQUIRED') : undefined}
              />
            )}
          />
          <Controller
            control={form.control}
            name="contactId"
            render={({ field, fieldState }) => (
              <Select
                label={t('fields.contact')}
                data={(contacts.data ?? []).map((c) => ({
                  value: c.id,
                  label: `${c.firstName} ${c.lastName}`,
                }))}
                value={field.value ?? null}
                onChange={(v) => field.onChange(v)}
                error={fieldState.error ? t('errors:validation.REQUIRED') : undefined}
              />
            )}
          />
          <EnumSelect
            control={form.control}
            name="vertical"
            ns="vertical"
            values={VERTICALS}
            label={t('fields.vertical')}
          />
          <EnumSelect
            control={form.control}
            name="billingEngine"
            ns="engine"
            values={BILLING_ENGINES}
            label={t('fields.engine')}
          />
          <EnumSelect
            control={form.control}
            name="origin"
            ns="origin"
            values={LEAD_ORIGINS}
            label={t('fields.origin')}
          />
          <EnumSelect
            control={form.control}
            name="forecastCategory"
            ns="forecast"
            values={FORECAST_CATEGORIES}
            label={t('fields.forecast')}
            clearable
          />
          <TextInput
            label={t('fields.amount')}
            {...form.register('amount')}
            error={fe(form.formState.errors.amount)}
          />
          <EnumSelect
            control={form.control}
            name="currency"
            ns="none"
            values={CURRENCIES}
            label={t('fields.currency')}
          />
          <TextInput
            type="date"
            label={t('fields.expectedClose')}
            {...form.register('expectedCloseDate')}
            error={fe(form.formState.errors.expectedCloseDate)}
          />
          <TextInput
            type="date"
            label={t('fields.firstContact')}
            {...form.register('firstContactDate')}
            error={fe(form.formState.errors.firstContactDate)}
          />
          <EnumSelect
            control={form.control}
            name="risk"
            ns="risk"
            values={RISK_LEVELS}
            label={t('fields.risk')}
            clearable
          />
        </SimpleGrid>
        <RuleErrors error={m.error} />
        <Button type="submit" loading={m.isPending}>
          {t('actions.create')}
        </Button>
      </Stack>
    </form>
  );
}

function Kanban({ rows }: { rows: OppRow[] }) {
  const { t } = useTranslation();
  const stages = Array.from({ length: 12 }, (_, i) => i);
  return (
    <ScrollArea type="auto" offsetScrollbars data-testid="kanban">
      <Group align="flex-start" wrap="nowrap" gap="sm">
        {stages.map((s) => {
          const items = rows.filter((r) => r.stage === s && r.status === 'OPEN');
          const total = items.reduce((a, r) => a + Number(r.amountUsd ?? 0), 0);
          return (
            <Card
              key={s}
              withBorder
              w={230}
              miw={230}
              padding="xs"
              bg="var(--mantine-color-default-hover)"
            >
              <Text size="sm" fw={600}>
                {t(`enums:stage.${s}`)}
              </Text>
              <Text size="xs" c="dimmed" mb="xs">
                {items.length} · {fmtMoney(total)}
              </Text>
              <Stack gap={6}>
                {items.map((o) => (
                  <Card
                    key={o.id}
                    withBorder
                    padding="xs"
                    component={Link}
                    to={`/oportunidades/${o.id}`}
                  >
                    <Text size="sm" fw={500} lineClamp={2}>
                      {o.name}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {o.accountName}
                    </Text>
                    <Group justify="space-between" mt={4}>
                      <Text size="xs">{fmtMoney(o.amountUsd)}</Text>
                      {o.risk && <EnumBadge ns="risk" value={o.risk} size="xs" />}
                    </Group>
                  </Card>
                ))}
              </Stack>
            </Card>
          );
        })}
      </Group>
    </ScrollArea>
  );
}

export default function OpportunitiesPage() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const nav = useNavigate();
  const [view, setView] = useState('kanban');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const list = useQuery({
    queryKey: ['opportunities', q],
    queryFn: () => api.get<OppRow[]>(`/opportunities${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  });
  const rows = list.data ?? [];
  return (
    <Stack>
      <PageHeader
        title={t('opps.title')}
        right={
          <>
            <ExportButtons entity="opportunities" />
            <TextInput
              size="xs"
              placeholder={t('actions.search')}
              value={q}
              onChange={(e) => setQ(e.currentTarget.value)}
            />
            <SegmentedControl
              size="xs"
              value={view}
              onChange={setView}
              data={[
                { value: 'kanban', label: t('ui.kanban') },
                { value: 'list', label: t('ui.list') },
              ]}
            />
            {canDo(me, 'P1', 'write') && (
              <Button size="xs" onClick={() => setCreating(true)}>
                {t('opps.new')}
              </Button>
            )}
          </>
        }
      />
      <RuleErrors error={list.error} />
      {view === 'kanban' ? (
        <Kanban rows={rows} />
      ) : (
        <Table striped highlightOnHover data-testid="opps-table">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('fields.code')}</Table.Th>
              <Table.Th>{t('fields.name')}</Table.Th>
              <Table.Th>{t('fields.account')}</Table.Th>
              <Table.Th>{t('fields.stage')}</Table.Th>
              <Table.Th>{t('fields.engine')}</Table.Th>
              <Table.Th>{t('fields.amount')}</Table.Th>
              <Table.Th>{t('fields.expectedClose')}</Table.Th>
              <Table.Th>{t('fields.forecast')}</Table.Th>
              <Table.Th>{t('fields.owner')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((o) => (
              <Table.Tr
                key={o.id}
                style={{ cursor: 'pointer' }}
                onClick={() => nav(`/oportunidades/${o.id}`)}
              >
                <Table.Td>{o.code}</Table.Td>
                <Table.Td fw={500}>
                  {o.name}{' '}
                  {o.registeredLate && (
                    <Badge size="xs" color="orange">
                      {t('fields.registeredLate')}
                    </Badge>
                  )}
                </Table.Td>
                <Table.Td>{o.accountName}</Table.Td>
                <Table.Td>
                  <StageBadge stage={o.stage} status={o.status} />
                </Table.Td>
                <Table.Td>{o.billingEngine}</Table.Td>
                <Table.Td>{fmtMoney(o.amount, o.amountCurrency)}</Table.Td>
                <Table.Td>{fmtDate(o.expectedCloseDate)}</Table.Td>
                <Table.Td>
                  {o.forecastCategory ? t(`enums:forecast.${o.forecastCategory}`) : '—'}
                </Table.Td>
                <Table.Td>{o.ownerName}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      <Modal opened={creating} onClose={() => setCreating(false)} title={t('opps.new')} size="lg">
        <CreateOpportunity onDone={(id) => nav(`/oportunidades/${id}`)} />
      </Modal>
    </Stack>
  );
}
