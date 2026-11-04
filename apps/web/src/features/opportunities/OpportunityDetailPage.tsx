import { Badge, Group, Paper, SimpleGrid, Skeleton, Stack, Tabs, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { RuleErrors } from '../../components/RuleErrors';
import { EnumBadge, StageBadge } from '../../components/ui';
import { fmtDate, fmtMoney, fmtPct } from '../../lib/format';
import { ApprovalTab } from './tabs/ApprovalTab';
import { ContractTab } from './tabs/ContractTab';
import { LinesTab } from './tabs/LinesTab';
import { MilestonesTab } from './tabs/MilestonesTab';
import { PriceRequestTab } from './tabs/PriceRequestTab';
import { QualificationTab } from './tabs/QualificationTab';
import { SummaryTab } from './tabs/SummaryTab';
import { TimelineTab } from './tabs/TimelineTab';
import type { OppDetail } from './types';

export function useOpportunity(id: string) {
  return useQuery({
    queryKey: ['opportunity', id],
    queryFn: () => api.get<OppDetail>(`/opportunities/${id}`),
  });
}

export default function OpportunityDetailPage() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const q = useOpportunity(id);
  if (q.error) return <RuleErrors error={q.error} />;
  const o = q.data;
  if (!o) return <Skeleton h={400} />;
  return (
    <Stack>
      <Group justify="space-between" align="flex-start">
        <div>
          <Text size="sm" c="dimmed">
            {o.code} · {o.account.name}
          </Text>
          <Title order={2} data-testid="opp-title">
            {o.name}
          </Title>
        </div>
        <Group>
          <StageBadge stage={o.stage} status={o.status} />
          <EnumBadge ns="health" value={o.health.status} />
          {o.health.score !== null && <Badge variant="outline">{o.health.score}/100</Badge>}
        </Group>
      </Group>
      <SimpleGrid cols={{ base: 2, md: 6 }}>
        <Paper withBorder p="xs">
          <Text size="xs" c="dimmed">
            {t('fields.amount')}
          </Text>
          <Text fw={600}>{fmtMoney(o.amount, o.amountCurrency)}</Text>
          <Text size="xs" c="dimmed">
            {fmtMoney(o.amountUsd, 'USD')} · {fmtMoney(o.amountCny, 'CNY')}
            {o.amountFxProvisional ? ' *' : ''}
          </Text>
        </Paper>
        <Paper withBorder p="xs">
          <Text size="xs" c="dimmed">
            {t('fields.engine')}
          </Text>
          <Text fw={600}>{t(`enums:engine.${o.billingEngine}`)}</Text>
        </Paper>
        <Paper withBorder p="xs">
          <Text size="xs" c="dimmed">
            {t('fields.expectedClose')}
          </Text>
          <Text fw={600}>{fmtDate(o.expectedCloseDate)}</Text>
        </Paper>
        <Paper withBorder p="xs">
          <Text size="xs" c="dimmed">
            {t('opps.approvedMargin')}
          </Text>
          <Text fw={600}>
            {fmtPct(o.approvedNetMargin)} / {fmtPct(o.approvedContractMargin)}
          </Text>
        </Paper>
        <Paper withBorder p="xs">
          <Text size="xs" c="dimmed">
            {t('opps.approvalExpires')}
          </Text>
          <Text fw={600}>{fmtDate(o.approvalExpiresOn)}</Text>
        </Paper>
        <Paper withBorder p="xs">
          <Text size="xs" c="dimmed">
            {t('opps.sheetVersion')}
          </Text>
          <Text fw={600}>{o.chinaSheetVersionLabel ?? '—'}</Text>
        </Paper>
      </SimpleGrid>
      <Tabs defaultValue="summary" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="summary">{t('opps.tabs.summary')}</Tabs.Tab>
          <Tabs.Tab value="qualification">{t('opps.tabs.qualification')}</Tabs.Tab>
          <Tabs.Tab value="priceRequest">{t('opps.tabs.priceRequest')}</Tabs.Tab>
          <Tabs.Tab value="lines">{t('opps.tabs.lines')}</Tabs.Tab>
          <Tabs.Tab value="approval">{t('opps.tabs.approval')}</Tabs.Tab>
          <Tabs.Tab value="contract">{t('opps.tabs.contract')}</Tabs.Tab>
          <Tabs.Tab value="milestones">{t('opps.tabs.milestones')}</Tabs.Tab>
          <Tabs.Tab value="timeline">{t('opps.tabs.timeline')}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="summary" pt="md">
          <SummaryTab opp={o} />
        </Tabs.Panel>
        <Tabs.Panel value="qualification" pt="md">
          <QualificationTab opp={o} />
        </Tabs.Panel>
        <Tabs.Panel value="priceRequest" pt="md">
          <PriceRequestTab opp={o} />
        </Tabs.Panel>
        <Tabs.Panel value="lines" pt="md">
          <LinesTab opp={o} />
        </Tabs.Panel>
        <Tabs.Panel value="approval" pt="md">
          <ApprovalTab opp={o} />
        </Tabs.Panel>
        <Tabs.Panel value="contract" pt="md">
          <ContractTab opp={o} />
        </Tabs.Panel>
        <Tabs.Panel value="milestones" pt="md">
          <MilestonesTab opp={o} />
        </Tabs.Panel>
        <Tabs.Panel value="timeline" pt="md">
          <TimelineTab opp={o} />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
