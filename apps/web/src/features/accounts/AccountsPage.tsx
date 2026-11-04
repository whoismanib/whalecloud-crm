import {
  Badge,
  Button,
  Checkbox,
  Drawer,
  Group,
  Modal,
  MultiSelect,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import {
  AccountCreateSchema,
  CONTACT_ROLES,
  ContactCreateSchema,
  CURRENCIES,
  CUSTOMER_TYPES,
  VERTICALS,
  type AccountCreate,
  type ContactCreate,
} from '@wcrm/shared';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { useCatalogs } from '../../api/catalogs';
import { canDo, useMe } from '../../auth/useMe';
import { RuleErrors } from '../../components/RuleErrors';
import { EnumBadge, EnumSelect, PageHeader, StageBadge, useFieldError } from '../../components/ui';
import { fmtMoney } from '../../lib/format';
import { useAction } from '../../lib/mutations';

interface AccountRow {
  id: string;
  name: string;
  countryCode: string;
  vertical: string;
  customerType: string;
  isKeyAccount: boolean;
  openOpportunities: number;
  openPipelineUsd: string;
  contactsCount: number;
}

function AccountForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const fe = useFieldError();
  const cat = useCatalogs();
  const [confirmDup, setConfirmDup] = useState(false);
  const form = useForm<AccountCreate>({
    resolver: zodResolver(AccountCreateSchema),
    defaultValues: {
      countryCode: 'CL',
      currency: 'USD',
      isKeyAccount: false,
      acceptsSimpleEsign: false,
    },
  });
  const m = useAction(
    (v: AccountCreate) => api.post(`/accounts${confirmDup ? '?confirmDuplicate=true' : ''}`, v),
    {
      invalidate: [['accounts']],
      onDone,
    },
  );
  const dup = m.error instanceof ApiError && m.error.code === 'DUPLICATE';
  return (
    <form onSubmit={form.handleSubmit((v) => m.mutate(v))}>
      <Stack>
        <SimpleGrid cols={2}>
          <TextInput
            label={t('fields.name')}
            {...form.register('name')}
            error={fe(form.formState.errors.name)}
          />
          <TextInput label={t('fields.legalName')} {...form.register('legalName')} />
          <TextInput label={t('fields.taxId')} {...form.register('taxId')} />
          <Controller
            control={form.control}
            name="countryCode"
            render={({ field }) => (
              <Select
                label={t('fields.country')}
                data={(cat.data?.countries ?? []).map((c) => ({
                  value: c.code,
                  label: `${c.code} · ${c.nameEs}`,
                }))}
                value={field.value}
                onChange={(v) => field.onChange(v)}
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
            name="customerType"
            ns="customerType"
            values={CUSTOMER_TYPES}
            label={t('fields.customerType')}
          />
          <Controller
            control={form.control}
            name="defaultBillingEntityId"
            render={({ field, fieldState }) => (
              <Select
                label={t('fields.billingEntity')}
                data={(cat.data?.billingEntities ?? []).map((b) => ({
                  value: b.id,
                  label: b.legalName,
                }))}
                value={field.value ?? null}
                onChange={(v) => field.onChange(v)}
                error={fieldState.error ? t('errors:validation.REQUIRED') : undefined}
              />
            )}
          />
          <EnumSelect
            control={form.control}
            name="currency"
            ns="none"
            values={CURRENCIES}
            label={t('fields.currency')}
          />
        </SimpleGrid>
        <Group>
          <Checkbox label={t('fields.keyAccount')} {...form.register('isKeyAccount')} />
          <Checkbox
            label={t('fields.acceptsSimpleEsign')}
            {...form.register('acceptsSimpleEsign')}
          />
        </Group>
        <RuleErrors error={m.error} />
        {dup && (
          <Checkbox
            label={t('actions.confirm')}
            checked={confirmDup}
            onChange={(e) => setConfirmDup(e.currentTarget.checked)}
          />
        )}
        <Button type="submit" loading={m.isPending}>
          {t('actions.create')}
        </Button>
      </Stack>
    </form>
  );
}

function ContactForm({ accountId }: { accountId: string }) {
  const { t } = useTranslation();
  const fe = useFieldError();
  const form = useForm<ContactCreate>({
    resolver: zodResolver(ContactCreateSchema),
    defaultValues: { buyingRoles: [] },
  });
  const m = useAction((v: ContactCreate) => api.post(`/accounts/${accountId}/contacts`, v), {
    invalidate: [['account', accountId]],
    onDone: () => form.reset({ buyingRoles: [] }),
  });
  return (
    <form onSubmit={form.handleSubmit((v) => m.mutate(v))}>
      <Stack gap="xs">
        <Title order={6}>{t('accounts.newContact')}</Title>
        <SimpleGrid cols={2}>
          <TextInput
            size="xs"
            label={t('fields.firstName')}
            {...form.register('firstName')}
            error={fe(form.formState.errors.firstName)}
          />
          <TextInput
            size="xs"
            label={t('fields.lastName')}
            {...form.register('lastName')}
            error={fe(form.formState.errors.lastName)}
          />
          <TextInput size="xs" label={t('fields.jobTitle')} {...form.register('jobTitle')} />
          <TextInput
            size="xs"
            label={t('fields.email')}
            {...form.register('email')}
            error={fe(form.formState.errors.email)}
          />
        </SimpleGrid>
        <Controller
          control={form.control}
          name="buyingRoles"
          render={({ field }) => (
            <MultiSelect
              size="xs"
              label={t('fields.buyingRoles')}
              data={CONTACT_ROLES.map((r) => ({ value: r, label: t(`enums:contactRole.${r}`) }))}
              value={field.value ?? []}
              onChange={field.onChange}
            />
          )}
        />
        <RuleErrors error={m.error} />
        <Button size="xs" type="submit" loading={m.isPending}>
          {t('actions.add')}
        </Button>
      </Stack>
    </form>
  );
}

function AccountDetail({ id }: { id: string }) {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const q = useQuery({
    queryKey: ['account', id],
    queryFn: () =>
      api.get<{
        name: string;
        contacts: {
          id: string;
          firstName: string;
          lastName: string;
          jobTitle: string | null;
          email: string | null;
          buyingRoles: string[];
        }[];
        opportunities: {
          id: string;
          code: string;
          name: string;
          stage: number;
          status: string;
          amountUsd: string;
        }[];
      }>(`/accounts/${id}`),
  });
  if (!q.data) return null;
  return (
    <Stack>
      <Title order={4}>{q.data.name}</Title>
      <Title order={6}>{t('accounts.contacts')}</Title>
      <Table striped>
        <Table.Tbody>
          {q.data.contacts.map((c) => (
            <Table.Tr key={c.id}>
              <Table.Td>
                {c.firstName} {c.lastName}
                <Text size="xs" c="dimmed">
                  {c.jobTitle} {c.email}
                </Text>
              </Table.Td>
              <Table.Td>
                <Group gap={4}>
                  {c.buyingRoles.map((r) => (
                    <Badge key={r} size="xs" variant="light">
                      {t(`enums:contactRole.${r}`)}
                    </Badge>
                  ))}
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {canDo(me, 'P1', 'write') && <ContactForm accountId={id} />}
      <Title order={6}>{t('opps.title')}</Title>
      {q.data.opportunities.map((o) => (
        <Group key={o.id} justify="space-between">
          <Link to={`/oportunidades/${o.id}`}>
            {o.code} · {o.name}
          </Link>
          <StageBadge stage={o.stage} status={o.status} />
        </Group>
      ))}
    </Stack>
  );
}

export default function AccountsPage() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['accounts', q],
    queryFn: () => api.get<AccountRow[]>(`/accounts${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  });
  return (
    <Stack>
      <PageHeader
        title={t('accounts.title')}
        right={
          <>
            <TextInput
              placeholder={t('actions.search')}
              value={q}
              onChange={(e) => setQ(e.currentTarget.value)}
              size="xs"
            />
            {canDo(me, 'P1', 'write') && (
              <Button size="xs" onClick={() => setCreating(true)}>
                {t('accounts.new')}
              </Button>
            )}
          </>
        }
      />
      <RuleErrors error={list.error} />
      <Table striped highlightOnHover data-testid="accounts-table">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('fields.name')}</Table.Th>
            <Table.Th>{t('fields.country')}</Table.Th>
            <Table.Th>{t('fields.vertical')}</Table.Th>
            <Table.Th>{t('fields.customerType')}</Table.Th>
            <Table.Th>{t('accounts.contacts')}</Table.Th>
            <Table.Th>{t('accounts.openOpps')}</Table.Th>
            <Table.Th>{t('accounts.pipelineUsd')}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {(list.data ?? []).map((a) => (
            <Table.Tr key={a.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(a.id)}>
              <Table.Td fw={600}>
                {a.name} {a.isKeyAccount && <Badge size="xs">★</Badge>}
              </Table.Td>
              <Table.Td>{a.countryCode}</Table.Td>
              <Table.Td>{t(`enums:vertical.${a.vertical}`)}</Table.Td>
              <Table.Td>
                <EnumBadge ns="customerType" value={a.customerType} />
              </Table.Td>
              <Table.Td>{a.contactsCount}</Table.Td>
              <Table.Td>{a.openOpportunities}</Table.Td>
              <Table.Td>{fmtMoney(a.openPipelineUsd)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Modal
        opened={creating}
        onClose={() => setCreating(false)}
        title={t('accounts.new')}
        size="lg"
      >
        <AccountForm onDone={() => setCreating(false)} />
      </Modal>
      <Drawer
        opened={Boolean(selected)}
        onClose={() => setSelected(null)}
        position="right"
        size="lg"
      >
        {selected && <AccountDetail id={selected} />}
      </Drawer>
    </Stack>
  );
}
