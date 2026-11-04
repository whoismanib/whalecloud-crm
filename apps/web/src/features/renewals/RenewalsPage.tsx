import { Anchor, Badge, Button, Paper, Stack, Table, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { canDo, useMe } from '../../auth/useMe';
import { RuleErrors } from '../../components/RuleErrors';
import { PageHeader, ScrollTable, StageBadge } from '../../components/ui';
import { fmtDate, fmtMoney } from '../../lib/format';
import { useAction } from '../../lib/mutations';

interface Renewal {
  id: string;
  contractTitle: string;
  contractType: string;
  billingEngine: string;
  accountName: string;
  ownerName: string | null;
  endDate: string;
  createOn: string;
  quoteBy: string;
  status: string;
  amount: string | null;
  currency: string | null;
  renewalOpportunityId: string | null;
  renewalStage: number | null;
  alert: 'NONE' | 'CREATE_OPPORTUNITY' | 'QUOTE_OVERDUE';
}

const ALERT_COLOR = { NONE: 'gray', CREATE_OPPORTUNITY: 'yellow', QUOTE_OVERDUE: 'red' } as const;

/** P10: L2/L3 renewal calendar (T−90 opportunity, T−60 quote) + overdue account reviews. */
export default function RenewalsPage() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const q = useQuery({ queryKey: ['renewals'], queryFn: () => api.get<Renewal[]>('/renewals') });
  const overdue = useQuery({
    queryKey: ['reviews-overdue'],
    queryFn: () =>
      api.get<{ accountId: string; accountName: string; periodStart: string }[]>(
        '/reviews/overdue',
      ),
  });
  const create = useAction((id: string) => api.post(`/renewals/${id}/create-opportunity`), {
    invalidate: [['renewals'], ['opportunities']],
  });
  return (
    <Stack>
      <PageHeader title={t('p2:renewal.title')} />
      <Text size="sm" c="dimmed">
        {t('p2:renewal.hint')}
      </Text>
      <RuleErrors error={q.error ?? create.error} />
      <ScrollTable striped withTableBorder data-testid="renewals-table">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('fields.account')}</Table.Th>
            <Table.Th>{t('p2:renewal.contract')}</Table.Th>
            <Table.Th>{t('p2:renewal.endDate')}</Table.Th>
            <Table.Th>{t('p2:renewal.createOn')}</Table.Th>
            <Table.Th>{t('p2:renewal.quoteBy')}</Table.Th>
            <Table.Th>{t('fields.amount')}</Table.Th>
            <Table.Th>{t('fields.status')}</Table.Th>
            <Table.Th>{t('p2:renewal.alert')}</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {(q.data ?? []).map((r) => (
            <Table.Tr key={r.id}>
              <Table.Td>
                {r.accountName}
                <Text size="xs" c="dimmed">
                  {r.ownerName}
                </Text>
              </Table.Td>
              <Table.Td>
                {r.contractTitle}
                <Text size="xs" c="dimmed">
                  {r.contractType} ·{' '}
                  {t(`enums:engine.${r.billingEngine}`, { defaultValue: r.billingEngine })}
                </Text>
              </Table.Td>
              <Table.Td>{fmtDate(r.endDate)}</Table.Td>
              <Table.Td>{fmtDate(r.createOn)}</Table.Td>
              <Table.Td>{fmtDate(r.quoteBy)}</Table.Td>
              <Table.Td>{fmtMoney(r.amount, r.currency ?? 'USD')}</Table.Td>
              <Table.Td>
                <Badge variant="light">{t(`p2:renewalStatus.${r.status}`)}</Badge>
                {r.renewalOpportunityId && r.renewalStage !== null && (
                  <Anchor
                    component={Link}
                    to={`/oportunidades/${r.renewalOpportunityId}`}
                    size="xs"
                    display="block"
                  >
                    <StageBadge stage={r.renewalStage} />
                  </Anchor>
                )}
              </Table.Td>
              <Table.Td>
                <Badge color={ALERT_COLOR[r.alert]} data-testid={`renewal-alert-${r.alert}`}>
                  {t(`p2:renewalAlert.${r.alert}`)}
                </Badge>
              </Table.Td>
              <Table.Td>
                {!r.renewalOpportunityId && canDo(me, 'P10', 'write') && (
                  <Button size="compact-xs" onClick={() => create.mutate(r.id)}>
                    {t('p2:renewal.createOpp')}
                  </Button>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </ScrollTable>
      <Paper withBorder p="sm">
        <Title order={5} mb="xs">
          {t('p2:review.overdueTitle')}
        </Title>
        {(overdue.data ?? []).length === 0 ? (
          <Text c="dimmed" size="sm">
            {t('ui.empty')}
          </Text>
        ) : (
          (overdue.data ?? []).map((o) => (
            <Text key={`${o.accountId}${o.periodStart}`} size="sm" data-testid="review-overdue">
              {o.accountName} · {t('p2:review.quarterOf', { date: fmtDate(o.periodStart) })}
            </Text>
          ))
        )}
      </Paper>
    </Stack>
  );
}
