import {
  Alert,
  Badge,
  Button,
  Group,
  List,
  NumberInput,
  Paper,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import type { BusinessCaseInput, UserRole } from '@wcrm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, type ProblemError } from '../../../api/client';
import { canDo, useMe } from '../../../auth/useMe';
import { RuleErrors, useRuleMessage } from '../../../components/RuleErrors';
import { EnumBadge } from '../../../components/ui';
import { fmtDate, fmtPct } from '../../../lib/format';
import { useAction } from '../../../lib/mutations';
import type { TabProps } from '../types';

interface Step {
  id: string;
  seq: number;
  kind: string;
  assigneeRole: UserRole;
  assigneeName?: string | null;
  status: string;
  dueOn: string | null;
  comment: string | null;
  condition: string | null;
  consultedRoles: string[];
  informedRoles: string[];
}
interface Preview {
  band: string;
  blocked: boolean;
  requiresCompetitiveJustification: boolean;
  requiresBusinessCase: boolean;
  businessCaseApproved: boolean;
  failures: ProblemError[];
  pendingRequirements: ProblemError[];
  conditions: string[];
  steps: Step[];
}
interface ApprovalReq {
  id: string;
  status: string;
  band: string;
  netMargin: string | null;
  contractMargin: string | null;
  requestedAt: string;
  expiresOn: string | null;
  invalidationReason: string | null;
  steps: Step[];
}

export function StepDecision({ step, invalidate }: { step: Step; invalidate: string[][] }) {
  const { t } = useTranslation();
  const [comment, setComment] = useState('');
  const decide = useAction(
    (decision: string) =>
      api.post(`/approval-steps/${step.id}/decision`, { decision, comment: comment || undefined }),
    {
      invalidate,
    },
  );
  return (
    <Stack gap={4}>
      <Textarea
        size="xs"
        placeholder={t('fields.comment')}
        value={comment}
        onChange={(e) => setComment(e.currentTarget.value)}
        autosize
        minRows={1}
      />
      <Group gap={4}>
        <Button
          size="xs"
          color="green"
          onClick={() => decide.mutate('APPROVED')}
          loading={decide.isPending}
          data-testid="approve-btn"
        >
          {t('actions.approve')}
        </Button>
        <Button
          size="xs"
          color="yellow"
          variant="light"
          onClick={() => decide.mutate('CHANGES_REQUESTED')}
        >
          {t('actions.requestChanges')}
        </Button>
        <Button size="xs" color="red" variant="light" onClick={() => decide.mutate('REJECTED')}>
          {t('actions.reject')}
        </Button>
      </Group>
      <RuleErrors error={decide.error} />
    </Stack>
  );
}

function BusinessCases({ opp }: TabProps) {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const inv = [
    ['opportunity', opp.id],
    ['approvalPreview', opp.currentSheetVersionId ?? ''],
  ];
  const [bc, setBc] = useState<BusinessCaseInput>({ tcoHorizonYears: 5, tcoCurrency: 'USD' });
  const create = useAction(() => api.post(`/opportunities/${opp.id}/business-cases`, bc), {
    invalidate: inv,
  });
  const submit = useAction((id: string) => api.post(`/business-cases/${id}/submit`), {
    invalidate: inv,
  });
  const decide = useAction(
    (id: string) => api.post(`/business-cases/${id}/decision`, { decision: 'APPROVED' }),
    { invalidate: inv },
  );
  const field = (k: keyof BusinessCaseInput, label: string) => (
    <Textarea
      size="xs"
      label={label}
      autosize
      minRows={1}
      value={String(bc[k] ?? '')}
      onChange={(e) => setBc({ ...bc, [k]: e.currentTarget.value })}
    />
  );
  return (
    <Paper withBorder p="md">
      <Title order={5}>{t('approval.businessCases')}</Title>
      {opp.businessCases.map((b) => (
        <Group key={b.id} justify="space-between" mt="xs">
          <Text size="sm">
            v{b.version} · {b.pain}
          </Text>
          <Group gap={4}>
            <EnumBadge ns="docStatus" value={b.status} />
            {b.status === 'DRAFT' && canDo(me, 'P4', 'write') && (
              <Button size="xs" variant="light" onClick={() => submit.mutate(b.id)}>
                {t('actions.submit')}
              </Button>
            )}
            {b.status === 'SUBMITTED' && canDo(me, 'P4', 'approve') && (
              <Button size="xs" color="green" onClick={() => decide.mutate(b.id)}>
                {t('actions.approve')}
              </Button>
            )}
          </Group>
        </Group>
      ))}
      <RuleErrors error={submit.error ?? decide.error} />
      {canDo(me, 'P4', 'write') && (
        <Stack gap={4} mt="md">
          <Text size="sm" fw={600}>
            {t('approval.newBusinessCase')}
          </Text>
          <SimpleGrid cols={2}>
            {field('pain', t('approval.bcPain'))}
            {field('baselineMetric', t('approval.bcBaseline'))}
            {field('benefit', t('approval.bcBenefit'))}
            {field('risks', t('approval.bcRisks'))}
            {field('strategicValue', t('approval.bcStrategic'))}
            <TextInput
              size="xs"
              label={`${t('approval.bcTco')} (USD)`}
              value={String(bc.tco ?? '')}
              onChange={(e) => setBc({ ...bc, tco: e.currentTarget.value })}
            />
            <NumberInput
              size="xs"
              label={t('approval.bcTcoYears')}
              min={3}
              max={5}
              value={bc.tcoHorizonYears ?? 5}
              onChange={(v) => setBc({ ...bc, tcoHorizonYears: Number(v) })}
            />
          </SimpleGrid>
          <RuleErrors error={create.error} />
          <Button size="xs" w="fit-content" onClick={() => create.mutate(undefined)}>
            {t('actions.create')}
          </Button>
        </Stack>
      )}
    </Paper>
  );
}

export function ApprovalTab({ opp }: TabProps) {
  const { t } = useTranslation();
  const msg = useRuleMessage();
  const { data: me } = useMe();
  const sheetId = opp.currentSheetVersionId;
  const preview = useQuery({
    queryKey: ['approvalPreview', sheetId],
    queryFn: () => api.get<Preview>(`/sheet-versions/${sheetId}/approval-preview`),
    enabled: Boolean(sheetId) && canDo(me, 'P6', 'view'),
  });
  const reqs = useQuery({
    queryKey: ['approvals', opp.id],
    queryFn: () => api.get<ApprovalReq[]>(`/opportunities/${opp.id}/approval-requests`),
    enabled: canDo(me, 'P6', 'view'),
  });
  const [justification, setJustification] = useState('');
  const inv = [
    ['opportunity', opp.id],
    ['approvals', opp.id],
    ['approvalPreview', sheetId ?? ''],
  ];
  const request = useAction(
    () =>
      api.post(`/sheet-versions/${sheetId}/approval-requests`, {
        competitiveJustification: justification || undefined,
      }),
    { invalidate: inv },
  );
  const p = preview.data;
  return (
    <SimpleGrid cols={{ base: 1, lg: 2 }}>
      <Stack>
        {p && (
          <Paper withBorder p="md" data-testid="approval-preview">
            <Group justify="space-between">
              <Title order={5}>{t('approval.preview')}</Title>
              <EnumBadge ns="band" value={p.band} size="lg" />
            </Group>
            {[
              ...p.failures,
              ...p.pendingRequirements.filter((f) => f.code !== 'NOT_QUOTABLE_BELOW_50'),
            ].length > 0 && (
              <Alert color={p.blocked ? 'red' : 'yellow'} mt="sm">
                <List size="sm">
                  {[
                    ...p.failures,
                    ...p.pendingRequirements.filter((f) => f.code !== 'NOT_QUOTABLE_BELOW_50'),
                  ].map((f, i) => (
                    <List.Item key={i}>{msg(f)}</List.Item>
                  ))}
                </List>
              </Alert>
            )}
            {p.conditions.length > 0 && (
              <Text size="sm" mt="xs">
                {t('approval.conditions')}:{' '}
                {p.conditions.map((c) => t(`enums:condition.${c}`)).join(', ')}
              </Text>
            )}
            <Table mt="sm">
              <Table.Tbody>
                {p.steps.map((s) => (
                  <Table.Tr key={s.seq}>
                    <Table.Td>{t(`enums:stepKind.${s.kind}`)}</Table.Td>
                    <Table.Td>{t(`enums:role.${s.assigneeRole}`)}</Table.Td>
                    <Table.Td>{fmtDate(s.dueOn)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            {canDo(me, 'P6', 'write') && !p.blocked && (
              <Stack gap="xs" mt="sm">
                {p.requiresCompetitiveJustification && (
                  <Textarea
                    label={t('approval.justification')}
                    value={justification}
                    onChange={(e) => setJustification(e.currentTarget.value)}
                  />
                )}
                <RuleErrors error={request.error} />
                <Button
                  w="fit-content"
                  onClick={() => request.mutate(undefined)}
                  loading={request.isPending}
                  data-testid="request-approval"
                >
                  {t('approval.request')}
                </Button>
              </Stack>
            )}
          </Paper>
        )}
        {(reqs.data ?? []).map((r) => (
          <Paper withBorder p="md" key={r.id}>
            <Group justify="space-between">
              <Group>
                <EnumBadge ns="approvalStatus" value={r.status} />
                <EnumBadge ns="band" value={r.band} variant="outline" />
              </Group>
              <Text size="sm">
                {fmtPct(r.netMargin)} / {fmtPct(r.contractMargin)}{' '}
                {r.expiresOn ? `· ${t('approval.expires', { date: fmtDate(r.expiresOn) })}` : ''}
              </Text>
            </Group>
            {r.invalidationReason && (
              <Text size="xs" c="dimmed">
                {r.invalidationReason}
              </Text>
            )}
            {r.steps.map((s) => (
              <Paper key={s.id} withBorder p="xs" mt="xs">
                <Group justify="space-between">
                  <Text size="sm">
                    {t(`enums:stepKind.${s.kind}`)}{' '}
                    {s.condition ? `(${t(`enums:condition.${s.condition}`)})` : ''} ·{' '}
                    {t(`enums:role.${s.assigneeRole}`)}
                    {s.assigneeName ? ` (${s.assigneeName})` : ''}
                  </Text>
                  <Badge
                    variant="light"
                    color={
                      s.status === 'APPROVED' ? 'green' : s.status === 'PENDING' ? 'yellow' : 'gray'
                    }
                  >
                    {t(`enums:approvalStatus.${s.status}`)}
                  </Badge>
                </Group>
                {s.comment && <Text size="xs">{s.comment}</Text>}
                {s.status === 'PENDING' &&
                  r.status === 'PENDING' &&
                  me?.roles.includes(s.assigneeRole) && <StepDecision step={s} invalidate={inv} />}
              </Paper>
            ))}
          </Paper>
        ))}
      </Stack>
      <BusinessCases opp={opp} />
    </SimpleGrid>
  );
}
