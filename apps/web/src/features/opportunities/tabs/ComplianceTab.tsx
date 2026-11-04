import {
  Alert,
  Badge,
  Button,
  Group,
  Paper,
  SegmentedControl,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import {
  COMPLIANCE_SECTIONS,
  complianceFailures,
  type ComplianceSection,
  type YesNoNa,
} from '@wcrm/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../api/client';
import { canDo, hasAction, useMe } from '../../../auth/useMe';
import { RuleErrors } from '../../../components/RuleErrors';
import { fmtDateTime } from '../../../lib/format';
import { useAction } from '../../../lib/mutations';
import type { TabProps } from '../types';

interface Item {
  section: ComplianceSection;
  itemCode: string;
  required: boolean;
  answer: YesNoNa | null;
  notes: string | null;
}
interface Checklist {
  id: string;
  version: number;
  status: string;
  requiredSections: ComplianceSection[];
  reviewComment: string | null;
  reviewedAt: string | null;
  approvedAt: string | null;
  items: Item[];
}

const STATUS_COLOR: Record<string, string> = {
  DRAFT: 'gray',
  IN_REVIEW: 'yellow',
  REVIEWED: 'blue',
  APPROVED: 'green',
  REJECTED: 'red',
};

/** P14: compliance checklist required before sending the proposal (gate 4→5). */
export function ComplianceTab({ opp }: TabProps) {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const key = ['compliance', opp.id];
  const q = useQuery({
    queryKey: key,
    queryFn: () =>
      api.get<{ current: Checklist | null; versions: { id: string; version: number }[] }>(
        `/opportunities/${opp.id}/compliance-checklists`,
      ),
  });
  const c = q.data?.current ?? null;
  const [answers, setAnswers] = useState<Record<string, { answer: YesNoNa | null; notes: string }>>(
    {},
  );
  const [comment, setComment] = useState('');
  useEffect(() => {
    if (c)
      setAnswers(
        Object.fromEntries(
          c.items.map((i) => [i.itemCode, { answer: i.answer, notes: i.notes ?? '' }]),
        ),
      );
  }, [c]);
  const inv = { invalidate: [key, ['opportunity', opp.id]] };
  const create = useAction(() => api.post(`/opportunities/${opp.id}/compliance-checklists`), inv);
  const save = useAction(
    () =>
      api.put(
        `/compliance-checklists/${c!.id}/items`,
        Object.entries(answers).map(([itemCode, v]) => ({
          itemCode,
          answer: v.answer,
          notes: v.notes || null,
        })),
      ),
    inv,
  );
  const submit = useAction(async () => {
    await api.put(
      `/compliance-checklists/${c!.id}/items`,
      Object.entries(answers).map(([itemCode, v]) => ({
        itemCode,
        answer: v.answer,
        notes: v.notes || null,
      })),
    );
    return api.post(`/compliance-checklists/${c!.id}/submit`);
  }, inv);
  const review = useAction(
    (status: 'REVIEWED' | 'REJECTED') =>
      api.post(`/compliance-checklists/${c!.id}/review`, { status, comment: comment || null }),
    inv,
  );
  const approve = useAction(() => api.post(`/compliance-checklists/${c!.id}/approve`), inv);
  const canWrite = canDo(me, 'P14', 'write');
  const editable = Boolean(c && ['DRAFT', 'REJECTED'].includes(c.status) && canWrite);
  const pending = c
    ? complianceFailures(
        c.items.map((i) => ({ ...i, answer: answers[i.itemCode]?.answer ?? null })),
        c.requiredSections,
      )
    : [];
  const err = create.error ?? save.error ?? submit.error ?? review.error ?? approve.error;
  return (
    <Stack data-testid="compliance-tab">
      <Group justify="space-between">
        <Group>
          <Title order={5}>{t('p2:compliance.title')}</Title>
          {c && (
            <>
              <Badge variant="light">v{c.version}</Badge>
              <Badge color={STATUS_COLOR[c.status]} data-testid="compliance-status">
                {t(`p2:checklistStatus.${c.status}`)}
              </Badge>
            </>
          )}
        </Group>
        {canWrite && (!c || ['APPROVED', 'REJECTED'].includes(c.status)) && (
          <Button size="xs" onClick={() => create.mutate(undefined)}>
            {c ? t('p2:compliance.newVersion') : t('p2:compliance.start')}
          </Button>
        )}
      </Group>
      <Text size="sm" c="dimmed">
        {t('p2:compliance.hint')}
      </Text>
      <RuleErrors error={err ?? q.error} />
      {c?.reviewComment && (
        <Alert
          color={c.status === 'REJECTED' ? 'red' : 'blue'}
          title={t('p2:compliance.legalComment')}
        >
          {c.reviewComment} {c.reviewedAt ? `· ${fmtDateTime(c.reviewedAt)}` : ''}
        </Alert>
      )}
      {c &&
        COMPLIANCE_SECTIONS.map((sec) => {
          const items = c.items.filter((i) => i.section === sec);
          const required = c.requiredSections.includes(sec);
          return (
            <Paper key={sec} withBorder p="sm">
              <Group gap="xs" mb="xs">
                <Text fw={600}>{t(`p2:complianceSection.${sec}`)}</Text>
                <Badge size="xs" color={required ? 'red' : 'gray'} variant="light">
                  {required ? t('p2:compliance.required') : t('p2:compliance.optional')}
                </Badge>
              </Group>
              <Table>
                <Table.Tbody>
                  {items.map((i) => (
                    <Table.Tr key={i.itemCode}>
                      <Table.Td w="50%">
                        <Text size="sm">{t(`p2:complianceItem.${i.itemCode}`)}</Text>
                      </Table.Td>
                      <Table.Td>
                        <SegmentedControl
                          size="xs"
                          disabled={!editable}
                          data={[
                            { value: 'YES', label: t('ui.yes') },
                            { value: 'NO', label: t('ui.no') },
                            { value: 'NA', label: t('p2:compliance.na') },
                          ]}
                          value={answers[i.itemCode]?.answer ?? ''}
                          onChange={(v) =>
                            setAnswers((a) => ({
                              ...a,
                              [i.itemCode]: {
                                notes: a[i.itemCode]?.notes ?? '',
                                answer: v as YesNoNa,
                              },
                            }))
                          }
                          data-testid={`ci-${i.itemCode}`}
                        />
                      </Table.Td>
                      <Table.Td>
                        <TextInput
                          size="xs"
                          disabled={!editable}
                          placeholder={t('fields.notes')}
                          value={answers[i.itemCode]?.notes ?? ''}
                          onChange={(e) => {
                            const notes = e.currentTarget.value;
                            setAnswers((a) => ({
                              ...a,
                              [i.itemCode]: { answer: a[i.itemCode]?.answer ?? null, notes },
                            }));
                          }}
                        />
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Paper>
          );
        })}
      {c && editable && (
        <>
          <RuleErrors failures={pending} />
          <Group>
            <Button size="xs" variant="default" onClick={() => save.mutate(undefined)}>
              {t('actions.save')}
            </Button>
            <Button
              size="xs"
              disabled={pending.length > 0}
              onClick={() => submit.mutate(undefined)}
            >
              {t('p2:compliance.submit')}
            </Button>
          </Group>
        </>
      )}
      {c?.status === 'IN_REVIEW' && hasAction(me, 'P14.checklist.review') && (
        <Paper withBorder p="sm">
          <TextInput
            size="xs"
            label={t('fields.comment')}
            value={comment}
            onChange={(e) => setComment(e.currentTarget.value)}
          />
          <Group mt="xs">
            <Button size="xs" color="green" onClick={() => review.mutate('REVIEWED')}>
              {t('p2:compliance.markReviewed')}
            </Button>
            <Button size="xs" color="red" variant="light" onClick={() => review.mutate('REJECTED')}>
              {t('actions.reject')}
            </Button>
          </Group>
        </Paper>
      )}
      {c?.status === 'REVIEWED' && hasAction(me, 'P14.checklist.approve') && (
        <Group>
          <Button
            size="xs"
            color="green"
            onClick={() => approve.mutate(undefined)}
            data-testid="compliance-approve"
          >
            {t('actions.approve')}
          </Button>
        </Group>
      )}
    </Stack>
  );
}
