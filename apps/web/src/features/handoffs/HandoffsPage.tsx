import { Anchor, Badge, Checkbox, Group, Stack, Table, Text, TextInput } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { HANDOFF_CHECKLIST } from '@wcrm/shared';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { canDo, useMe } from '../../auth/useMe';
import { RuleErrors } from '../../components/RuleErrors';
import { PageHeader, StageBadge } from '../../components/ui';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { useAction } from '../../lib/mutations';

interface Handoff {
  id: string;
  opportunityId: string;
  opportunityName: string;
  accountName: string;
  stage: number;
  dueOn: string | null;
  meetingAt: string | null;
  zmpProjectId: string | null;
  plannedStart: string | null;
  actualStart: string | null;
  checklistMissing: string[];
  onTime: boolean | null;
  overdue: boolean;
  meetingLate: boolean;
  [k: string]: unknown;
}

/** P9: delivery hand-offs, SLA < 5 business days from signature, meeting checklist. */
export default function HandoffsPage() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const q = useQuery({ queryKey: ['handoffs'], queryFn: () => api.get<Handoff[]>('/handoffs') });
  const patch = useAction(
    ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.patch(`/handoffs/${id}`, body),
    { invalidate: [['handoffs']] },
  );
  const canWrite = canDo(me, 'P9', 'write');
  return (
    <Stack>
      <PageHeader title={t('p2:handoff.title')} />
      <Text size="sm" c="dimmed">
        {t('p2:handoff.hint')}
      </Text>
      <RuleErrors error={q.error ?? patch.error} />
      <Table striped withTableBorder data-testid="handoffs-table">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('fields.account')}</Table.Th>
            <Table.Th>{t('fields.stage')}</Table.Th>
            <Table.Th>{t('p2:handoff.dueOn')}</Table.Th>
            <Table.Th>{t('p2:handoff.meeting')}</Table.Th>
            <Table.Th>{t('p2:handoff.checklist')}</Table.Th>
            <Table.Th>{t('fields.zmpProjectId')}</Table.Th>
            <Table.Th>{t('p2:handoff.actualStart')}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {(q.data ?? []).map((h) => (
            <Table.Tr key={h.id}>
              <Table.Td>
                <Anchor component={Link} to={`/oportunidades/${h.opportunityId}`} size="sm">
                  {h.opportunityName}
                </Anchor>
                <Text size="xs" c="dimmed">
                  {h.accountName}
                </Text>
              </Table.Td>
              <Table.Td>
                <StageBadge stage={h.stage} />
              </Table.Td>
              <Table.Td>{fmtDate(h.dueOn)}</Table.Td>
              <Table.Td>
                <Text size="sm">{fmtDateTime(h.meetingAt)}</Text>
                <Badge
                  size="xs"
                  color={h.onTime === false || h.overdue ? 'red' : h.onTime ? 'green' : 'gray'}
                >
                  {t(
                    h.overdue
                      ? 'p2:handoff.overdue'
                      : h.onTime === false || h.meetingLate
                        ? 'p2:handoff.late'
                        : h.onTime
                          ? 'p2:handoff.onTime'
                          : 'p2:handoff.pending',
                  )}
                </Badge>
              </Table.Td>
              <Table.Td>
                <Stack gap={2}>
                  {HANDOFF_CHECKLIST.map((k) => (
                    <Checkbox
                      key={k}
                      size="xs"
                      label={t(`p2:handoff.items.${k}`)}
                      checked={Boolean(h[k])}
                      disabled={!canWrite}
                      onChange={(e) =>
                        patch.mutate({ id: h.id, body: { [k]: e.currentTarget.checked } })
                      }
                    />
                  ))}
                </Stack>
              </Table.Td>
              <Table.Td>{h.zmpProjectId ?? '—'}</Table.Td>
              <Table.Td>
                <Group gap={4}>
                  <TextInput
                    size="xs"
                    type="date"
                    w={140}
                    disabled={!canWrite}
                    defaultValue={h.actualStart ?? ''}
                    onBlur={(e) =>
                      e.currentTarget.value !== (h.actualStart ?? '') &&
                      patch.mutate({
                        id: h.id,
                        body: { actualStart: e.currentTarget.value || null },
                      })
                    }
                  />
                </Group>
                <Text size="xs" c="dimmed">
                  {t('p2:handoff.plannedStart')}: {fmtDate(h.plannedStart)}
                </Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}
