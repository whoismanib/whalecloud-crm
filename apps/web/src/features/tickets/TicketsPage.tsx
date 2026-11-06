import {
  Badge,
  Button,
  Checkbox,
  CopyButton,
  Group,
  Modal,
  Paper,
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
  BALL_IN,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  TicketCreateSchema,
  type TicketCreate,
} from '@wcrm/shared';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { canDo, useMe } from '../../auth/useMe';
import { ExportButtons } from '../../components/ExportButtons';
import { RuleErrors } from '../../components/RuleErrors';
import { EnumBadge, EnumSelect, PageHeader, ScrollTable, useFieldError } from '../../components/ui';
import { fmtDate, fmtDateTime, todayIso } from '../../lib/format';
import { useAction } from '../../lib/mutations';
import { EdoPanel } from './EdoPanel';

interface Ticket {
  id: string;
  accountName: string;
  number: string;
  title: string;
  priority: string;
  status: string;
  ballIn: string;
  orgHolder: string | null;
  ownerName: string | null;
  slaDueOn: string | null;
  openedOn: string;
  lastUpdateAt: string;
  isOpen: boolean;
  agingDays: number;
  daysSinceUpdate: number;
  slaOverdue: boolean;
  pushToday: boolean;
  externalSource: string | null;
}

function NewTicket({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const fe = useFieldError();
  const accounts = useQuery({
    queryKey: ['accounts', ''],
    queryFn: () => api.get<{ id: string; name: string }[]>('/accounts'),
  });
  const form = useForm<TicketCreate>({
    resolver: zodResolver(TicketCreateSchema),
    defaultValues: { openedOn: todayIso(), ballIn: 'WHALE', status: 'OPEN', priority: 'P2' },
  });
  const m = useAction((v: TicketCreate) => api.post('/tickets', v), {
    invalidate: [['tickets']],
    onDone,
  });
  return (
    <form onSubmit={form.handleSubmit((v) => m.mutate(v))}>
      <Stack>
        <Controller
          control={form.control}
          name="accountId"
          render={({ field }) => (
            <Select
              label={t('fields.account')}
              data={(accounts.data ?? []).map((a) => ({ value: a.id, label: a.name }))}
              value={field.value ?? null}
              onChange={field.onChange}
            />
          )}
        />
        <SimpleGrid cols={2}>
          <TextInput
            label={t('fields.number')}
            {...form.register('number')}
            error={fe(form.formState.errors.number)}
          />
          <EnumSelect
            control={form.control}
            name="priority"
            ns="ticketPriority"
            values={TICKET_PRIORITIES}
            label={t('tickets.priority')}
          />
          <EnumSelect
            control={form.control}
            name="ballIn"
            ns="ballIn"
            values={BALL_IN}
            label={t('tickets.ballIn')}
          />
          <TextInput type="date" label={t('tickets.openedOn')} {...form.register('openedOn')} />
          <TextInput
            type="date"
            label={t('tickets.sla')}
            {...form.register('slaDueOn', { setValueAs: (v) => v || null })}
          />
          <TextInput label={t('tickets.orgHolder')} {...form.register('orgHolder')} />
        </SimpleGrid>
        <TextInput
          label={t('fields.title')}
          {...form.register('title')}
          error={fe(form.formState.errors.title)}
        />
        <RuleErrors error={m.error} />
        <Button type="submit">{t('actions.create')}</Button>
      </Stack>
    </form>
  );
}

export default function TicketsPage() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [creating, setCreating] = useState(false);
  const q = useQuery({
    queryKey: ['tickets'],
    queryFn: () => api.get<Ticket[]>('/tickets?manual=1'),
  });
  const update = useAction(
    ({ id, patch }: { id: string; patch: Record<string, string> }) =>
      api.patch(`/tickets/${id}`, patch),
    {
      invalidate: [['tickets']],
    },
  );
  const canWrite = canDo(me, 'P10', 'write');
  // eDo tickets live in the panel above; this list keeps the tickets typed in the CRM.
  const manual = (q.data ?? []).filter((r) => !r.externalSource);
  const rows = manual.filter((r) => !onlyOpen || r.isOpen);
  const push = manual.filter((r) => r.pushToday);
  return (
    <Stack>
      <EdoPanel />
      <PageHeader
        title={t('tickets.manualTitle')}
        right={
          <>
            <ExportButtons entity="tickets" />
            <Checkbox
              label={t('tickets.onlyOpen')}
              checked={onlyOpen}
              onChange={(e) => setOnlyOpen(e.currentTarget.checked)}
            />
            {canWrite && (
              <Button size="xs" onClick={() => setCreating(true)}>
                {t('tickets.new')}
              </Button>
            )}
          </>
        }
      />
      <RuleErrors error={q.error ?? update.error} />
      {push.length > 0 && (
        <Paper withBorder p="sm" data-testid="push-today">
          <Text fw={600} mb={4}>
            {t('tickets.pushToday')}
          </Text>
          {push.map((p) => (
            <Group key={p.id} justify="space-between">
              <Text size="sm">
                <EnumBadge ns="ballIn" value={p.ballIn} size="xs" /> {p.number} · {p.title} ·{' '}
                {t('tickets.days', { count: p.daysSinceUpdate })}
              </Text>
              <CopyButton
                value={t('tickets.reminder', {
                  number: p.number,
                  title: p.title,
                  days: p.daysSinceUpdate,
                })}
              >
                {({ copy, copied }) => (
                  <Button
                    size="compact-xs"
                    variant="light"
                    onClick={copy}
                    color={copied ? 'green' : undefined}
                  >
                    {t('tickets.copyReminder')}
                  </Button>
                )}
              </CopyButton>
            </Group>
          ))}
        </Paper>
      )}
      <ScrollTable striped withTableBorder data-testid="tickets-table">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('fields.number')}</Table.Th>
            <Table.Th>{t('fields.title')}</Table.Th>
            <Table.Th>{t('tickets.priority')}</Table.Th>
            <Table.Th>{t('fields.status')}</Table.Th>
            <Table.Th>{t('tickets.ballIn')}</Table.Th>
            <Table.Th>{t('tickets.orgHolder')}</Table.Th>
            <Table.Th>{t('tickets.sla')}</Table.Th>
            <Table.Th>{t('tickets.aging')}</Table.Th>
            <Table.Th>{t('tickets.lastUpdate')}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((r) => (
            <Table.Tr key={r.id}>
              <Table.Td>
                {r.number}
                <Text size="xs" c="dimmed">
                  {r.accountName}
                </Text>
              </Table.Td>
              <Table.Td>{r.title}</Table.Td>
              <Table.Td>
                <Badge
                  variant="light"
                  color={r.priority === 'P1' ? 'red' : r.priority === 'P2' ? 'orange' : 'gray'}
                >
                  {r.priority}
                </Badge>
              </Table.Td>
              <Table.Td>
                {canWrite ? (
                  <Select
                    size="xs"
                    w={150}
                    data={TICKET_STATUSES.map((s) => ({
                      value: s,
                      label: t(`enums:ticketStatus.${s}`),
                    }))}
                    value={r.status}
                    onChange={(v) => v && update.mutate({ id: r.id, patch: { status: v } })}
                  />
                ) : (
                  t(`enums:ticketStatus.${r.status}`)
                )}
              </Table.Td>
              <Table.Td>
                {canWrite ? (
                  <Select
                    size="xs"
                    w={100}
                    data={BALL_IN.map((b) => ({ value: b, label: t(`enums:ballIn.${b}`) }))}
                    value={r.ballIn}
                    onChange={(v) => v && update.mutate({ id: r.id, patch: { ballIn: v } })}
                  />
                ) : (
                  <EnumBadge ns="ballIn" value={r.ballIn} />
                )}
              </Table.Td>
              <Table.Td>{r.orgHolder}</Table.Td>
              <Table.Td>
                <Text size="sm" c={r.slaOverdue ? 'red' : undefined}>
                  {fmtDate(r.slaDueOn)}
                </Text>
              </Table.Td>
              <Table.Td>{t('tickets.days', { count: r.agingDays })}</Table.Td>
              <Table.Td>{fmtDateTime(r.lastUpdateAt)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </ScrollTable>
      <Modal
        opened={creating}
        onClose={() => setCreating(false)}
        title={t('tickets.new')}
        size="lg"
      >
        <NewTicket onDone={() => setCreating(false)} />
      </Modal>
    </Stack>
  );
}
