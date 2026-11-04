import {
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  Paper,
  Progress,
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
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { canDo, hasAction, useMe } from '../../auth/useMe';
import { RuleErrors } from '../../components/RuleErrors';
import { PageHeader } from '../../components/ui';
import { fmtDate, fmtNumber, fmtPct, todayIso } from '../../lib/format';
import { useAction } from '../../lib/mutations';
import { useContractsLite } from '../p2/lookups';

interface ResidentPo {
  id: string;
  poNumber: string;
  accountName: string;
  contractTitle: string;
  totalHours: string;
  consumedHours: string;
  remainingHours: string;
  excessHours: string;
  pct: number;
  alert: 'NONE' | 'WARN_80' | 'CRITICAL_100';
  validFrom: string | null;
  validTo: string | null;
  monthly: { month: string; hours: string }[];
  monthsToExhaustion: number | null;
}

const ALERT_COLOR = { NONE: 'green', WARN_80: 'orange', CRITICAL_100: 'red' } as const;

function NewPo({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const contracts = useContractsLite();
  const [v, setV] = useState({
    contractId: '',
    poNumber: '',
    totalHours: '',
    validFrom: '',
    validTo: '',
  });
  const m = useAction(
    () =>
      api.post('/resident-pos', {
        ...v,
        validFrom: v.validFrom || null,
        validTo: v.validTo || null,
      }),
    { invalidate: [['resident-pos']], onDone },
  );
  return (
    <Stack>
      <Select
        label={t('p2:capacity.contract')}
        searchable
        data={(contracts.data ?? [])
          .filter((c) => c.type === 'OC')
          .map((c) => ({ value: c.id, label: `${c.accountName} · ${c.title}` }))}
        value={v.contractId || null}
        onChange={(x) => setV({ ...v, contractId: x ?? '' })}
      />
      <TextInput
        label={t('p2:cr.poNumber')}
        value={v.poNumber}
        onChange={(e) => setV({ ...v, poNumber: e.currentTarget.value })}
      />
      <TextInput
        label={t('p2:capacity.totalHours')}
        value={v.totalHours}
        onChange={(e) => setV({ ...v, totalHours: e.currentTarget.value })}
      />
      <SimpleGrid cols={2}>
        <TextInput
          type="date"
          label={t('p2:distributor.startsOn')}
          value={v.validFrom}
          onChange={(e) => setV({ ...v, validFrom: e.currentTarget.value })}
        />
        <TextInput
          type="date"
          label={t('p2:distributor.endsOn')}
          value={v.validTo}
          onChange={(e) => setV({ ...v, validTo: e.currentTarget.value })}
        />
      </SimpleGrid>
      <RuleErrors error={m.error} />
      <Button onClick={() => m.mutate(undefined)}>{t('actions.create')}</Button>
    </Stack>
  );
}

/** P16: resident hours (ZMP/FOL export) vs PO balance; 80 % alert suggests a CR or renewal. */
export default function CapacityPage() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const [creating, setCreating] = useState(false);
  const month = `${todayIso().slice(0, 7)}-01`;
  const [imp, setImp] = useState({ month, csv: '' });
  const q = useQuery({
    queryKey: ['resident-pos'],
    queryFn: () => api.get<ResidentPo[]>('/resident-pos'),
  });
  const noPo = useQuery({
    queryKey: ['hours-without-po'],
    queryFn: () =>
      api.get<
        {
          month: string;
          poNumber: string | null;
          residentName: string;
          hours: string;
          excessHours: string;
        }[]
      >('/reports/hours-without-po'),
  });
  const importHours = useAction(
    () => api.post<{ rows: number; errors: unknown[] }>('/resident-pos/hours-imports', imp),
    {
      invalidate: [['resident-pos'], ['hours-without-po']],
      onDone: () => setImp({ ...imp, csv: '' }),
    },
  );
  return (
    <Stack>
      <PageHeader
        title={t('p2:capacity.title')}
        right={
          canDo(me, 'P16', 'write') && (
            <Button size="xs" onClick={() => setCreating(true)}>
              {t('p2:capacity.newPo')}
            </Button>
          )
        }
      />
      <RuleErrors error={q.error ?? importHours.error} />
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        {(q.data ?? []).map((p) => (
          <Paper key={p.id} withBorder p="md" data-testid="po-card">
            <Group justify="space-between">
              <Title order={5}>
                OC {p.poNumber} · {p.accountName}
              </Title>
              <Badge color={ALERT_COLOR[p.alert]} data-testid={`po-alert-${p.alert}`}>
                {t(`p2:capacityAlert.${p.alert}`)}
              </Badge>
            </Group>
            <Text size="xs" c="dimmed">
              {p.contractTitle} · {fmtDate(p.validFrom)} → {fmtDate(p.validTo)}
            </Text>
            <Progress
              mt="sm"
              size="lg"
              value={Math.min(100, p.pct * 100)}
              color={ALERT_COLOR[p.alert]}
            />
            <Group justify="space-between" mt={4}>
              <Text size="sm">
                {fmtNumber(p.consumedHours, 0)} / {fmtNumber(p.totalHours, 0)} h ({fmtPct(p.pct)})
              </Text>
              <Text size="sm">
                {t('p2:capacity.remaining')}: {fmtNumber(p.remainingHours, 0)} h
              </Text>
            </Group>
            {Number(p.excessHours) > 0 && (
              <Text size="sm" c="red">
                {t('p2:capacity.excess')}: {fmtNumber(p.excessHours, 0)} h
              </Text>
            )}
            {p.monthsToExhaustion !== null && (
              <Text size="xs" c="dimmed">
                {t('p2:capacity.exhaustion', { months: fmtNumber(p.monthsToExhaustion, 1) })}
              </Text>
            )}
            {p.alert !== 'NONE' && (
              <Alert mt="xs" color={ALERT_COLOR[p.alert]} p="xs">
                {t('p2:capacity.suggestion')}
              </Alert>
            )}
            <Table mt="xs">
              <Table.Tbody>
                {p.monthly.map((m) => (
                  <Table.Tr key={m.month}>
                    <Table.Td>{m.month.slice(0, 7)}</Table.Td>
                    <Table.Td>{fmtNumber(m.hours, 0)} h</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Paper>
        ))}
      </SimpleGrid>
      {(noPo.data ?? []).length > 0 && (
        <Paper withBorder p="sm" data-testid="hours-without-po">
          <Title order={6}>{t('p2:capacity.withoutPo')}</Title>
          {(noPo.data ?? []).map((r, i) => (
            <Text key={i} size="sm">
              {r.month.slice(0, 7)} · {r.residentName} · OC {r.poNumber ?? '—'} ·{' '}
              {fmtNumber(r.hours, 0)} h
            </Text>
          ))}
        </Paper>
      )}
      {hasAction(me, 'P16.hours.import') && (
        <Paper withBorder p="sm">
          <Title order={6}>{t('p2:capacity.import')}</Title>
          <Text size="xs" c="dimmed">
            {t('p2:capacity.importHint')}
          </Text>
          <TextInput
            size="xs"
            type="date"
            w={180}
            label={t('p2:capacity.month')}
            value={imp.month}
            onChange={(e) => setImp({ ...imp, month: e.currentTarget.value })}
          />
          <Textarea
            size="xs"
            autosize
            minRows={4}
            label="CSV"
            placeholder="poNumber;resident;hours"
            value={imp.csv}
            onChange={(e) => setImp({ ...imp, csv: e.currentTarget.value })}
          />
          <Button size="xs" mt="xs" onClick={() => importHours.mutate(undefined)}>
            {t('p2:capacity.importBtn')}
          </Button>
        </Paper>
      )}
      <Modal opened={creating} onClose={() => setCreating(false)} title={t('p2:capacity.newPo')}>
        <NewPo onDone={() => setCreating(false)} />
      </Modal>
    </Stack>
  );
}
