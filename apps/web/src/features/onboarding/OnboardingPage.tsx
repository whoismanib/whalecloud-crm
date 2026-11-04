import {
  Badge,
  Button,
  Checkbox,
  Group,
  Modal,
  MultiSelect,
  NumberInput,
  Paper,
  Progress,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { ONBOARDING_ITEMS, type OnboardingItem } from '@wcrm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { useCatalogs } from '../../api/catalogs';
import { canDo, useMe } from '../../auth/useMe';
import { RuleErrors } from '../../components/RuleErrors';
import { PageHeader } from '../../components/ui';
import { fmtDate, todayIso } from '../../lib/format';
import { useAction } from '../../lib/mutations';

interface Onboarding {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  countryCode: string;
  startDate: string;
  productiveTargetOn: string;
  productiveAt: string | null;
  items: { item: OnboardingItem; doneAt: string | null }[];
  done: number;
  total: number;
  firstOpportunityOn: string | null;
  daysToFirstOpportunity: number | null;
  overdue: boolean;
}
interface Kit {
  countryCode: string;
  items: OnboardingItem[];
  productiveDays: number;
}

function Kits() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const q = useQuery({
    queryKey: ['onboarding-kits'],
    queryFn: () => api.get<Kit[]>('/onboarding/kits'),
  });
  const [edit, setEdit] = useState<Kit>({
    countryCode: 'PE',
    items: [...ONBOARDING_ITEMS],
    productiveDays: 30,
  });
  const save = useAction(
    () =>
      api.put(`/onboarding/kits/${edit.countryCode}`, {
        items: edit.items,
        productiveDays: edit.productiveDays,
      }),
    { invalidate: [['onboarding-kits']] },
  );
  return (
    <Paper withBorder p="sm">
      <Title order={6} mb="xs">
        {t('p2:onboarding.kits')}
      </Title>
      {(q.data ?? []).map((k) => (
        <Text
          key={k.countryCode}
          size="sm"
          style={{ cursor: 'pointer' }}
          onClick={() => setEdit(k)}
        >
          <b>{k.countryCode}</b> · {k.items.map((i) => t(`p2:onboardingItem.${i}`)).join(', ')} ·{' '}
          {t('p2:onboarding.productiveDays', { count: k.productiveDays })}
        </Text>
      ))}
      {canDo(me, 'P15', 'write') && (
        <SimpleGrid cols={{ base: 1, md: 4 }} mt="xs">
          <TextInput
            size="xs"
            label={t('fields.country')}
            value={edit.countryCode}
            onChange={(e) =>
              setEdit({ ...edit, countryCode: e.currentTarget.value.toUpperCase().slice(0, 2) })
            }
          />
          <MultiSelect
            size="xs"
            label={t('p2:onboarding.items')}
            data={ONBOARDING_ITEMS.map((i) => ({ value: i, label: t(`p2:onboardingItem.${i}`) }))}
            value={edit.items}
            onChange={(v) => setEdit({ ...edit, items: v as OnboardingItem[] })}
          />
          <NumberInput
            size="xs"
            label={t('p2:onboarding.days')}
            value={edit.productiveDays}
            onChange={(v) => setEdit({ ...edit, productiveDays: Number(v) || 30 })}
          />
          <Button size="xs" mt={22} onClick={() => save.mutate(undefined)}>
            {t('actions.save')}
          </Button>
        </SimpleGrid>
      )}
      <RuleErrors error={save.error} />
    </Paper>
  );
}

function NewOnboarding({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const cat = useCatalogs();
  const [v, setV] = useState({ userId: '', countryCode: 'CL', startDate: todayIso() });
  const m = useAction(() => api.post('/onboarding', v), { invalidate: [['onboarding']], onDone });
  return (
    <Stack>
      <Select
        label={t('p2:onboarding.person')}
        searchable
        data={(cat.data?.users ?? []).map((u) => ({ value: u.id, label: u.fullName }))}
        value={v.userId || null}
        onChange={(x) => setV({ ...v, userId: x ?? '' })}
      />
      <TextInput
        label={t('fields.country')}
        value={v.countryCode}
        onChange={(e) =>
          setV({ ...v, countryCode: e.currentTarget.value.toUpperCase().slice(0, 2) })
        }
      />
      <TextInput
        type="date"
        label={t('p2:onboarding.startDate')}
        value={v.startDate}
        onChange={(e) => setV({ ...v, startDate: e.currentTarget.value })}
      />
      <RuleErrors error={m.error} />
      <Button onClick={() => m.mutate(undefined)}>{t('actions.create')}</Button>
    </Stack>
  );
}

/** P15: per-country onboarding kit/checklist and time to first opportunity. */
export default function OnboardingPage() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const [creating, setCreating] = useState(false);
  const q = useQuery({
    queryKey: ['onboarding'],
    queryFn: () => api.get<Onboarding[]>('/onboarding'),
  });
  const toggle = useAction(
    ({ id, item, done }: { id: string; item: string; done: boolean }) =>
      api.patch(`/onboarding/${id}/items/${item}`, { done }),
    { invalidate: [['onboarding']] },
  );
  const isManager = canDo(me, 'P15', 'write');
  return (
    <Stack>
      <PageHeader
        title={t('p2:onboarding.title')}
        right={
          isManager && (
            <Button size="xs" onClick={() => setCreating(true)}>
              {t('p2:onboarding.new')}
            </Button>
          )
        }
      />
      <RuleErrors error={q.error ?? toggle.error} />
      <Table striped withTableBorder data-testid="onboarding-table">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('p2:onboarding.person')}</Table.Th>
            <Table.Th>{t('p2:onboarding.startDate')}</Table.Th>
            <Table.Th>{t('p2:onboarding.progress')}</Table.Th>
            <Table.Th>{t('p2:onboarding.checklist')}</Table.Th>
            <Table.Th>{t('p2:onboarding.firstOpp')}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {(q.data ?? []).map((o) => (
            <Table.Tr key={o.id}>
              <Table.Td>
                {o.fullName}
                <Text size="xs" c="dimmed">
                  {o.email} · {o.countryCode}
                </Text>
              </Table.Td>
              <Table.Td>
                {fmtDate(o.startDate)}
                <Text size="xs" c="dimmed">
                  {t('p2:onboarding.target')}: {fmtDate(o.productiveTargetOn)}
                </Text>
              </Table.Td>
              <Table.Td w={180}>
                <Progress
                  value={(o.done / Math.max(1, o.total)) * 100}
                  color={o.overdue ? 'red' : 'blue'}
                />
                <Group gap={4} mt={4}>
                  <Text size="xs">
                    {o.done}/{o.total}
                  </Text>
                  {o.overdue && (
                    <Badge size="xs" color="red">
                      {t('p2:onboarding.overdue')}
                    </Badge>
                  )}
                  {o.productiveAt && (
                    <Badge size="xs" color="green">
                      {t('p2:onboarding.productive')}
                    </Badge>
                  )}
                </Group>
              </Table.Td>
              <Table.Td>
                <Group gap={6}>
                  {o.items.map((i) => (
                    <Checkbox
                      key={i.item}
                      size="xs"
                      label={t(`p2:onboardingItem.${i.item}`)}
                      checked={Boolean(i.doneAt)}
                      disabled={!(isManager || o.userId === me?.id)}
                      onChange={(e) =>
                        toggle.mutate({ id: o.id, item: i.item, done: e.currentTarget.checked })
                      }
                    />
                  ))}
                </Group>
              </Table.Td>
              <Table.Td>
                {o.firstOpportunityOn ? (
                  <>
                    {fmtDate(o.firstOpportunityOn)}
                    <Text size="xs" c="dimmed">
                      {t('p2:onboarding.daysCount', { count: o.daysToFirstOpportunity ?? 0 })}
                    </Text>
                  </>
                ) : (
                  <Text size="sm" c="dimmed">
                    —
                  </Text>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Kits />
      <Modal opened={creating} onClose={() => setCreating(false)} title={t('p2:onboarding.new')}>
        <NewOnboarding onDone={() => setCreating(false)} />
      </Modal>
    </Stack>
  );
}
