import {
  Badge,
  Button,
  Group,
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
import { ACCOUNT_REVIEW_KINDS, quarterStart } from '@wcrm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { canDo, useMe } from '../../auth/useMe';
import { RuleErrors } from '../../components/RuleErrors';
import { EnumBadge } from '../../components/ui';
import { fmtDate, fmtMoney, todayIso } from '../../lib/format';
import { useAction } from '../../lib/mutations';

interface Plan {
  id: string;
  year: number;
  status: string;
  objectives: string | null;
  growthOpportunities: string | null;
  risks: string | null;
  target: string | null;
  targetCurrency: string | null;
  approvedAt: string | null;
}
interface Review {
  id: string;
  kind: string;
  periodStart: string;
  heldOn: string;
  findings: string;
  actions: string | null;
  edoTicketStats: Record<string, number> | null;
}

/** P10: annual account plan + quarterly / monthly eDo reviews (inside the account drawer). */
export function AccountPlanPanel({ accountId }: { accountId: string }) {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const year = Number(todayIso().slice(0, 4));
  const plans = useQuery({
    queryKey: ['plans', accountId],
    queryFn: () => api.get<Plan[]>(`/accounts/${accountId}/plans`),
    enabled: canDo(me, 'P10', 'view'),
  });
  const reviews = useQuery({
    queryKey: ['reviews', accountId],
    queryFn: () => api.get<Review[]>(`/accounts/${accountId}/reviews`),
    enabled: canDo(me, 'P10', 'view'),
  });
  const current = (plans.data ?? []).find((p) => p.year === year);
  const [plan, setPlan] = useState({
    objectives: '',
    growthOpportunities: '',
    risks: '',
    target: '',
  });
  const [rv, setRv] = useState({
    kind: 'QUARTERLY' as (typeof ACCOUNT_REVIEW_KINDS)[number],
    periodStart: quarterStart(todayIso()),
    heldOn: todayIso(),
    findings: '',
    actions: '',
  });
  const inv = { invalidate: [['plans', accountId], ['reviews', accountId], ['reviews-overdue']] };
  const savePlan = useAction(
    () =>
      api.post(`/accounts/${accountId}/plans`, {
        year,
        objectives: plan.objectives || current?.objectives || null,
        growthOpportunities: plan.growthOpportunities || current?.growthOpportunities || null,
        risks: plan.risks || current?.risks || null,
        target: plan.target || current?.target || null,
        targetCurrency: 'USD',
      }),
    inv,
  );
  const approve = useAction((id: string) => api.post(`/account-plans/${id}/approve`), inv);
  const addReview = useAction(
    () => api.post(`/accounts/${accountId}/reviews`, { ...rv, actions: rv.actions || null }),
    { ...inv, onDone: () => setRv((r) => ({ ...r, findings: '', actions: '' })) },
  );
  if (!canDo(me, 'P10', 'view')) return null;
  const canWrite = canDo(me, 'P10', 'write');
  return (
    <Stack data-testid="account-plan">
      <Group justify="space-between">
        <Title order={6}>
          {t('p2:plan.title')} {year}
        </Title>
        {current && <EnumBadge ns="docStatus" value={current.status} />}
      </Group>
      {current ? (
        <Paper withBorder p="xs">
          <Text size="sm">
            <b>{t('p2:plan.objectives')}:</b> {current.objectives ?? '—'}
          </Text>
          <Text size="sm">
            <b>{t('p2:plan.growth')}:</b> {current.growthOpportunities ?? '—'}
          </Text>
          <Text size="sm">
            <b>{t('p2:plan.risks')}:</b> {current.risks ?? '—'}
          </Text>
          <Text size="sm">
            <b>{t('p2:plan.target')}:</b>{' '}
            {fmtMoney(current.target, current.targetCurrency ?? 'USD')}
          </Text>
          {current.status !== 'APPROVED' && canDo(me, 'P10', 'approve') && (
            <Button size="compact-xs" mt="xs" onClick={() => approve.mutate(current.id)}>
              {t('actions.approve')}
            </Button>
          )}
        </Paper>
      ) : (
        <Text size="sm" c="dimmed">
          {t('p2:plan.none')}
        </Text>
      )}
      {canWrite && current?.status !== 'APPROVED' && (
        <SimpleGrid cols={2}>
          <Textarea
            size="xs"
            label={t('p2:plan.objectives')}
            value={plan.objectives}
            onChange={(e) => setPlan({ ...plan, objectives: e.currentTarget.value })}
          />
          <Textarea
            size="xs"
            label={t('p2:plan.growth')}
            value={plan.growthOpportunities}
            onChange={(e) => setPlan({ ...plan, growthOpportunities: e.currentTarget.value })}
          />
          <Textarea
            size="xs"
            label={t('p2:plan.risks')}
            value={plan.risks}
            onChange={(e) => setPlan({ ...plan, risks: e.currentTarget.value })}
          />
          <TextInput
            size="xs"
            label={`${t('p2:plan.target')} (USD)`}
            value={plan.target}
            onChange={(e) => setPlan({ ...plan, target: e.currentTarget.value })}
          />
          <Button size="xs" onClick={() => savePlan.mutate(undefined)}>
            {t('actions.save')}
          </Button>
        </SimpleGrid>
      )}
      <Title order={6}>{t('p2:review.title')}</Title>
      <Table striped>
        <Table.Tbody>
          {(reviews.data ?? []).map((r) => (
            <Table.Tr key={r.id}>
              <Table.Td>
                <Badge size="xs" variant="light">
                  {t(`p2:reviewKind.${r.kind}`)}
                </Badge>
                <Text size="xs" c="dimmed">
                  {fmtDate(r.periodStart)} · {fmtDate(r.heldOn)}
                </Text>
              </Table.Td>
              <Table.Td>
                <Text size="sm">{r.findings}</Text>
                {r.edoTicketStats && (
                  <Text size="xs" c="dimmed">
                    {t('p2:review.edoStats', r.edoTicketStats)}
                  </Text>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {canWrite && (
        <SimpleGrid cols={2}>
          <Select
            size="xs"
            label={t('fields.type')}
            data={ACCOUNT_REVIEW_KINDS.map((k) => ({ value: k, label: t(`p2:reviewKind.${k}`) }))}
            value={rv.kind}
            onChange={(v) => v && setRv({ ...rv, kind: v as typeof rv.kind })}
          />
          <TextInput
            size="xs"
            type="date"
            label={t('p2:review.periodStart')}
            value={rv.periodStart}
            onChange={(e) => setRv({ ...rv, periodStart: e.currentTarget.value })}
          />
          <TextInput
            size="xs"
            type="date"
            label={t('p2:review.heldOn')}
            value={rv.heldOn}
            onChange={(e) => setRv({ ...rv, heldOn: e.currentTarget.value })}
          />
          <Textarea
            size="xs"
            label={t('p2:review.findings')}
            value={rv.findings}
            onChange={(e) => setRv({ ...rv, findings: e.currentTarget.value })}
          />
          <Textarea
            size="xs"
            label={t('p2:review.actions')}
            value={rv.actions}
            onChange={(e) => setRv({ ...rv, actions: e.currentTarget.value })}
          />
          <Button size="xs" onClick={() => addReview.mutate(undefined)}>
            {t('actions.add')}
          </Button>
        </SimpleGrid>
      )}
      <RuleErrors error={plans.error ?? savePlan.error ?? approve.error ?? addReview.error} />
    </Stack>
  );
}
