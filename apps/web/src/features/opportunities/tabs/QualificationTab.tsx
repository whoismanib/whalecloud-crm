import {
  Button,
  Group,
  MultiSelect,
  Paper,
  Progress,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import {
  BANT_KEYS,
  CONTACT_ROLES,
  MEDDPICC_KEYS,
  meddpiccScore,
  QUAL_STATUSES,
  type Qualification,
} from '@wcrm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../../api/client';
import { canDo, useMe } from '../../../auth/useMe';
import { RuleErrors } from '../../../components/RuleErrors';
import { useAction } from '../../../lib/mutations';
import type { TabProps } from '../types';

export function QualificationTab({ opp }: TabProps) {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const canWrite = canDo(me, 'P2', 'write');
  const [q, setQ] = useState<Qualification>(() => {
    const out = {} as Qualification;
    for (const k of [...BANT_KEYS, ...MEDDPICC_KEYS])
      out[k] = (opp.qualification[k] ?? 'EMPTY') as Qualification[typeof k];
    return out;
  });
  const [roles, setRoles] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(opp.contacts.map((c) => [c.id, c.roles])),
  );
  const inv = [['opportunity', opp.id]];
  const saveQ = useAction(
    () => api.put(`/opportunities/${opp.id}/qualification`, { ...q, notes: {} }),
    { invalidate: inv },
  );
  const saveRoles = useAction(
    () =>
      api.put(
        `/opportunities/${opp.id}/contacts`,
        Object.entries(roles).map(([contactId, r]) => ({ contactId, roles: r })),
      ),
    { invalidate: inv },
  );
  const score = meddpiccScore(q);
  const required = Number(opp.amountUsd) > 500000;
  const row = (k: keyof Qualification) => (
    <Group key={k} justify="space-between" wrap="nowrap">
      <Text size="sm">{t(`qual.${k}`)}</Text>
      <SegmentedControl
        size="xs"
        disabled={!canWrite}
        value={q[k]}
        onChange={(v) => setQ({ ...q, [k]: v as Qualification[typeof k] })}
        data={QUAL_STATUSES.map((s) => ({ value: s, label: t(`enums:qual.${s}`) }))}
      />
    </Group>
  );
  return (
    <SimpleGrid cols={{ base: 1, lg: 2 }}>
      <Paper withBorder p="md">
        <Stack gap="xs">
          <Title order={5}>{t('qual.bant')}</Title>
          {BANT_KEYS.map(row)}
          <Title order={5} mt="md">
            {t('qual.meddpicc')}
          </Title>
          <Text size="xs" c={required ? 'orange' : 'dimmed'}>
            {required ? t('qual.required') : t('qual.optional')}
          </Text>
          {MEDDPICC_KEYS.map(row)}
          <Progress value={score * 100} color={score >= 0.5 ? 'green' : 'orange'} mt="xs" />
          <Text size="sm" data-testid="meddpicc-score">
            {t('qual.score', { value: Math.round(score * 100) })}
          </Text>
          <RuleErrors error={saveQ.error} />
          {canWrite && (
            <Button
              onClick={() => saveQ.mutate(undefined)}
              loading={saveQ.isPending}
              w="fit-content"
            >
              {t('actions.save')}
            </Button>
          )}
        </Stack>
      </Paper>
      <Paper withBorder p="md">
        <Stack gap="xs">
          <Title order={5}>{t('qual.contactRoles')}</Title>
          {opp.contacts.map((c) => (
            <MultiSelect
              key={c.id}
              disabled={!canWrite}
              label={`${c.firstName} ${c.lastName}${c.jobTitle ? ` · ${c.jobTitle}` : ''}`}
              data={CONTACT_ROLES.map((r) => ({ value: r, label: t(`enums:contactRole.${r}`) }))}
              value={roles[c.id] ?? []}
              onChange={(v) => setRoles({ ...roles, [c.id]: v })}
            />
          ))}
          <RuleErrors error={saveRoles.error} />
          {canWrite && (
            <Button onClick={() => saveRoles.mutate(undefined)} w="fit-content">
              {t('actions.save')}
            </Button>
          )}
        </Stack>
      </Paper>
    </SimpleGrid>
  );
}
