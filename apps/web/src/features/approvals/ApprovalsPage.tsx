import { Badge, Paper, SimpleGrid, Stack, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import type { UserRole } from '@wcrm/shared';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { RuleErrors } from '../../components/RuleErrors';
import { EnumBadge, PageHeader } from '../../components/ui';
import { fmtDate, fmtMoney, fmtPct } from '../../lib/format';
import { StepDecision } from '../opportunities/tabs/ApprovalTab';

interface InboxItem {
  id: string;
  kind: string;
  condition: string | null;
  assigneeRole: UserRole;
  status: string;
  dueOn: string | null;
  comment: string | null;
  seq: number;
  consultedRoles: string[];
  informedRoles: string[];
  overdue: boolean;
  opportunityId: string;
  opportunityName: string;
  opportunityCode: string;
  accountName: string;
  amountUsd: string;
  requestedByName: string | null;
  request: {
    band: string;
    netMargin: string | null;
    contractMargin: string | null;
    competitiveJustification: string | null;
    minLineMargin: string | null;
  };
}

export default function ApprovalsPage() {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['approvals', 'inbox'],
    queryFn: () => api.get<InboxItem[]>('/approvals?assignedToMe=true&status=PENDING'),
  });
  return (
    <Stack>
      <PageHeader title={t('approval.inbox')} />
      <RuleErrors error={q.error} />
      {(q.data ?? []).length === 0 && <Text c="dimmed">{t('ui.empty')}</Text>}
      <SimpleGrid cols={{ base: 1, lg: 2 }} data-testid="approvals-inbox">
        {(q.data ?? []).map((s) => (
          <Paper withBorder p="md" key={s.id}>
            <Text size="xs" c="dimmed">
              {s.opportunityCode} · {s.accountName}
            </Text>
            <Text fw={600} component={Link} to={`/oportunidades/${s.opportunityId}`}>
              {s.opportunityName}
            </Text>
            <Stack gap={4} mt="xs">
              <Text size="sm">
                {t(`enums:stepKind.${s.kind}`)}{' '}
                {s.condition ? `· ${t(`enums:condition.${s.condition}`)}` : ''}
              </Text>
              <Text size="sm">
                <EnumBadge ns="band" value={s.request.band} /> {t('sheet.netMargin')}{' '}
                {fmtPct(s.request.netMargin)} · {t('sheet.contractMargin')}{' '}
                {fmtPct(s.request.contractMargin)} · {fmtMoney(s.amountUsd)}
              </Text>
              {s.request.competitiveJustification && (
                <Text size="sm" c="dimmed">
                  {t('approval.justification')}: {s.request.competitiveJustification}
                </Text>
              )}
              <Text size="xs">
                {t('approval.dueOn')}: {fmtDate(s.dueOn)}{' '}
                {s.overdue && (
                  <Badge color="red" size="xs">
                    {t('enums:sla.OVERDUE')}
                  </Badge>
                )}
              </Text>
              {s.consultedRoles.length > 0 && (
                <Text size="xs" c="dimmed">
                  {t('approval.consulted', {
                    roles: s.consultedRoles.map((r) => t(`enums:role.${r}`)).join(', '),
                  })}
                </Text>
              )}
              <StepDecision step={s} invalidate={[['approvals']]} />
            </Stack>
          </Paper>
        ))}
      </SimpleGrid>
    </Stack>
  );
}
