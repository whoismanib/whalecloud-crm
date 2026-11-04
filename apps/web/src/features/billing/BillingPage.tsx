import {
  Badge,
  Button,
  Checkbox,
  Group,
  Modal,
  Paper,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { ESCALATION_RESPONSIBILITY, type CollectionStep } from '@wcrm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { hasAction, useMe } from '../../auth/useMe';
import { RuleErrors } from '../../components/RuleErrors';
import { ExportButtons } from '../../components/ExportButtons';
import { EnumBadge, PageHeader, ScrollTable } from '../../components/ui';
import { fmtDate, fmtMoney } from '../../lib/format';
import { useAction } from '../../lib/mutations';
import { PaymentModal, type Invoice } from '../opportunities/tabs/MilestonesTab';

interface InvoiceRow extends Invoice {
  accountName: string;
  milestoneName: string;
  opportunityId: string;
  opportunityName: string;
  issuedOn: string;
  escalation: Invoice['escalation'] & {
    responsibleRoles: string[];
    notifyRoles: string[];
    paid: boolean;
  };
}
interface ActionRow {
  id: string;
  step: CollectionStep;
  scheduledOn: string;
  responsibleRole: string;
  notifiedRoles: string[];
  status: string;
  outcome: string | null;
  invoiceNumber: string;
  accountName: string;
  balance: string;
  currency: string;
  assigneeName: string | null;
  due: boolean;
}

export default function BillingPage() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const [onlyDue, setOnlyDue] = useState(true);
  const [payFor, setPayFor] = useState<InvoiceRow | null>(null);
  const [completeFor, setCompleteFor] = useState<ActionRow | null>(null);
  const [outcome, setOutcome] = useState('');
  const invs = useQuery({
    queryKey: ['invoices'],
    queryFn: () => api.get<InvoiceRow[]>('/invoices'),
  });
  const actions = useQuery({
    queryKey: ['collection-actions', onlyDue],
    queryFn: () =>
      api.get<ActionRow[]>(`/collection-actions?status=PENDING${onlyDue ? '&due=true' : ''}`),
  });
  const complete = useAction(
    () => api.post(`/collection-actions/${completeFor?.id}/complete`, { outcome }),
    {
      invalidate: [['collection-actions']],
      onDone: () => {
        setCompleteFor(null);
        setOutcome('');
      },
    },
  );
  const rows = invs.data ?? [];
  const sum = (f: (r: InvoiceRow) => boolean, v: (r: InvoiceRow) => number) =>
    rows.filter(f).reduce((a, r) => a + v(r), 0);
  const invoicedUsd = sum(
    (r) => r.amountCurrency === 'USD',
    (r) => Number(r.amount),
  );
  const pendingUsd = sum(
    (r) => r.amountCurrency === 'USD',
    (r) => Number(r.balance),
  );
  const overdue = rows.filter((r) => Number(r.balance) > 0 && r.escalation.daysOverdue > 0);
  const roles = me?.roles ?? [];
  return (
    <Stack>
      <PageHeader title={t('billing.title')} right={<ExportButtons entity="invoices" />} />
      <RuleErrors error={invs.error ?? actions.error} />
      <SimpleGrid cols={{ base: 2, md: 4 }}>
        <Paper withBorder p="sm">
          <Text size="xs" c="dimmed">
            {t('billing.invoiced')}
          </Text>
          <Text fw={700}>{fmtMoney(invoicedUsd)}</Text>
        </Paper>
        <Paper withBorder p="sm">
          <Text size="xs" c="dimmed">
            {t('billing.paid')}
          </Text>
          <Text fw={700} c="green">
            {fmtMoney(invoicedUsd - pendingUsd)}
          </Text>
        </Paper>
        <Paper withBorder p="sm">
          <Text size="xs" c="dimmed">
            {t('billing.pending')}
          </Text>
          <Text fw={700} c="yellow.7">
            {fmtMoney(pendingUsd)}
          </Text>
        </Paper>
        <Paper withBorder p="sm">
          <Text size="xs" c="dimmed">
            {t('billing.overdue')} ({overdue.length})
          </Text>
          <Text fw={700} c="red">
            {fmtMoney(
              overdue
                .filter((r) => r.amountCurrency === 'USD')
                .reduce((a, r) => a + Number(r.balance), 0),
            )}
          </Text>
        </Paper>
      </SimpleGrid>
      <Title order={4}>{t('billing.invoices')}</Title>
      <ScrollTable striped withTableBorder data-testid="invoices-table">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('fields.number')}</Table.Th>
            <Table.Th>{t('fields.account')}</Table.Th>
            <Table.Th>{t('milestone.list')}</Table.Th>
            <Table.Th>{t('fields.amount')}</Table.Th>
            <Table.Th>{t('milestone.balance')}</Table.Th>
            <Table.Th>{t('milestone.dueOn')}</Table.Th>
            <Table.Th>{t('billing.escalation')}</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((r) => (
            <Table.Tr
              key={r.id}
              bg={r.escalation.daysOverdue > 30 ? 'var(--mantine-color-red-light)' : undefined}
            >
              <Table.Td>{r.number}</Table.Td>
              <Table.Td>{r.accountName}</Table.Td>
              <Table.Td>
                <Link to={`/oportunidades/${r.opportunityId}`}>{r.opportunityName}</Link>
                <Text size="xs" c="dimmed">
                  {r.milestoneName}
                </Text>
              </Table.Td>
              <Table.Td>{fmtMoney(r.amount, r.amountCurrency)}</Table.Td>
              <Table.Td>{fmtMoney(r.balance, r.amountCurrency)}</Table.Td>
              <Table.Td>
                {fmtDate(r.dueOn)}
                {r.escalation.daysOverdue > 0 && (
                  <Text size="xs" c="red">
                    {t('billing.daysOverdue', { count: r.escalation.daysOverdue })}
                  </Text>
                )}
              </Table.Td>
              <Table.Td>
                {r.escalation.paid ? (
                  <EnumBadge ns="invoiceStatus" value="PAID" />
                ) : (
                  <Stack gap={2}>
                    {r.escalation.currentStep && (
                      <Badge color="red">
                        {t(`enums:collectionStep.${r.escalation.currentStep}`)}
                      </Badge>
                    )}
                    <Text size="xs">{t(`enums:bucket.${r.escalation.bucket}`)}</Text>
                    {r.escalation.nextStep && (
                      <Text size="xs" c="dimmed">
                        {t('billing.next', {
                          step: t(`enums:collectionStep.${r.escalation.nextStep}`),
                          date: fmtDate(r.escalation.nextOn),
                        })}
                      </Text>
                    )}
                  </Stack>
                )}
              </Table.Td>
              <Table.Td>
                {hasAction(me, 'P8.payment.write') && Number(r.balance) > 0 && (
                  <Button size="compact-xs" onClick={() => setPayFor(r)}>
                    {t('milestone.payment')}
                  </Button>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </ScrollTable>
      <Group justify="space-between">
        <Title order={4}>{t('billing.actions')}</Title>
        <Checkbox
          label={t('billing.onlyDue')}
          checked={onlyDue}
          onChange={(e) => setOnlyDue(e.currentTarget.checked)}
        />
      </Group>
      <ScrollTable striped withTableBorder data-testid="collection-actions">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('fields.date')}</Table.Th>
            <Table.Th>{t('billing.escalation')}</Table.Th>
            <Table.Th>{t('fields.account')}</Table.Th>
            <Table.Th>{t('milestone.balance')}</Table.Th>
            <Table.Th>{t('billing.responsible')}</Table.Th>
            <Table.Th>{t('billing.notify')}</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {(actions.data ?? []).map((a) => (
            <Table.Tr key={a.id}>
              <Table.Td>{fmtDate(a.scheduledOn)}</Table.Td>
              <Table.Td>{t(`enums:collectionStep.${a.step}`)}</Table.Td>
              <Table.Td>
                {a.accountName} · {a.invoiceNumber}
              </Table.Td>
              <Table.Td>{fmtMoney(a.balance, a.currency)}</Table.Td>
              <Table.Td>
                {t(`enums:role.${a.responsibleRole}`)} {a.assigneeName ? `(${a.assigneeName})` : ''}
              </Table.Td>
              <Table.Td>{a.notifiedRoles.map((r) => t(`enums:role.${r}`)).join(', ')}</Table.Td>
              <Table.Td>
                {a.due &&
                  ESCALATION_RESPONSIBILITY[a.step].responsibleRoles.some((r) =>
                    roles.includes(r),
                  ) && (
                    <Button size="compact-xs" onClick={() => setCompleteFor(a)}>
                      {t('billing.complete')}
                    </Button>
                  )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </ScrollTable>
      <Modal
        opened={Boolean(payFor)}
        onClose={() => setPayFor(null)}
        title={t('milestone.payment')}
      >
        {payFor && (
          <PaymentModal
            invoice={payFor}
            invalidate={[['invoices'], ['collection-actions']]}
            onClose={() => setPayFor(null)}
          />
        )}
      </Modal>
      <Modal
        opened={Boolean(completeFor)}
        onClose={() => setCompleteFor(null)}
        title={t('billing.complete')}
      >
        <Stack>
          <Textarea
            label={t('billing.outcome')}
            value={outcome}
            onChange={(e) => setOutcome(e.currentTarget.value)}
          />
          <RuleErrors error={complete.error} />
          <Button onClick={() => complete.mutate(undefined)}>{t('actions.save')}</Button>
        </Stack>
      </Modal>
    </Stack>
  );
}
