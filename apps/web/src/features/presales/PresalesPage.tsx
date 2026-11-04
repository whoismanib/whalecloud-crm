import {
  Alert,
  Anchor,
  Badge,
  Button,
  Drawer,
  Group,
  Modal,
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
import { COMPLIANCE_ANSWERS, CURRENCIES, RFP_TYPES } from '@wcrm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useCatalogs } from '../../api/catalogs';
import { canDo, useMe } from '../../auth/useMe';
import { RuleErrors } from '../../components/RuleErrors';
import { PageHeader, ScrollTable } from '../../components/ui';
import { fmtDate, fmtPct, todayIso } from '../../lib/format';
import { useAction } from '../../lib/mutations';

interface Rfp {
  id: string;
  opportunityId: string;
  opportunityName?: string;
  accountName?: string;
  type: string;
  title: string;
  receivedOn: string;
  clientDeadline: string;
  internalDeadline: string;
  decisionDueOn: string;
  decision: 'PENDING' | 'PARTICIPATE' | 'DECLINE';
  decisionReason: string | null;
  decidedOn: string | null;
  documentsUrl: string | null;
  cmReviewedAt: string | null;
  deliveredOn: string | null;
  result: string;
  winningCompetitor: string | null;
  compliancePct: string | null;
  alerts: string[];
}
interface Requirement {
  id: string;
  ref: string | null;
  requirement: string;
  answer: string;
  comment: string | null;
  assigneeUserId: string | null;
  assigneeName: string | null;
  answeredAt: string | null;
}
interface Kpis {
  delivered: number;
  onTimePct: number | null;
  decided: number;
  decisionOnTimePct: number | null;
  withResult: number;
  winRate: number | null;
}

const DECISION_COLOR = { PENDING: 'yellow', PARTICIPATE: 'green', DECLINE: 'gray' } as const;
const ANSWER_COLOR: Record<string, string> = {
  COMPLIES: 'green',
  PARTIAL: 'yellow',
  NOT_COMPLIES: 'red',
  PENDING: 'gray',
};

function RfpDetail({ id }: { id: string }) {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const cat = useCatalogs();
  const key = ['rfp', id];
  const q = useQuery({
    queryKey: key,
    queryFn: () =>
      api.get<
        Rfp & {
          requirements: Requirement[];
          compliance: { total: number; answered: number; pct: number | null };
        }
      >(`/rfps/${id}`),
  });
  const inv = { invalidate: [key, ['rfps']] };
  const [reason, setReason] = useState('');
  const [newReq, setNewReq] = useState({ ref: '', requirement: '', assigneeUserId: '' });
  const [result, setResult] = useState({
    result: 'WON',
    winningCompetitor: '',
    winningPrice: '',
    winningCurrency: 'USD',
  });
  const decide = useAction(
    (decision: 'PARTICIPATE' | 'DECLINE') =>
      api.post(`/rfps/${id}/decision`, { decision, reason: reason || null }),
    inv,
  );
  const addReq = useAction(
    () =>
      api.post(`/rfps/${id}/requirements`, [
        {
          ref: newReq.ref || null,
          requirement: newReq.requirement,
          assigneeUserId: newReq.assigneeUserId || null,
        },
      ]),
    { ...inv, onDone: () => setNewReq({ ref: '', requirement: '', assigneeUserId: '' }) },
  );
  const patchReq = useAction(
    ({ reqId, body }: { reqId: string; body: Record<string, unknown> }) =>
      api.patch(`/rfp-requirements/${reqId}`, body),
    inv,
  );
  const review = useAction(() => api.post(`/rfps/${id}/cm-review`, {}), inv);
  const deliver = useAction(() => api.post(`/rfps/${id}/deliver`, {}), inv);
  const saveResult = useAction(
    () =>
      api.post(`/rfps/${id}/result`, {
        result: result.result,
        winningCompetitor: result.winningCompetitor || null,
        winningPrice: result.winningPrice || null,
        winningCurrency: result.winningPrice ? result.winningCurrency : null,
      }),
    inv,
  );
  const r = q.data;
  if (!r) return <RuleErrors error={q.error} />;
  const canWrite = canDo(me, 'P3', 'write');
  const open = !r.deliveredOn;
  const users = (cat.data?.users ?? []).map((u) => ({ value: u.id, label: u.fullName }));
  const err =
    decide.error ??
    addReq.error ??
    patchReq.error ??
    review.error ??
    deliver.error ??
    saveResult.error;
  return (
    <Stack data-testid="rfp-detail">
      <Group justify="space-between">
        <Title order={4}>{r.title}</Title>
        <Badge>{r.type}</Badge>
      </Group>
      <Anchor component={Link} to={`/oportunidades/${r.opportunityId}`} size="sm">
        {r.opportunityName}
      </Anchor>
      <SimpleGrid cols={{ base: 2, sm: 4 }}>
        {(
          [
            ['receivedOn', r.receivedOn],
            ['decisionDueOn', r.decisionDueOn],
            ['internalDeadline', r.internalDeadline],
            ['clientDeadline', r.clientDeadline],
          ] as const
        ).map(([k, v]) => (
          <Paper key={k} withBorder p="xs">
            <Text size="xs" c="dimmed">
              {t(`p3:rfp.${k}`)}
            </Text>
            <Text fw={600}>{fmtDate(v)}</Text>
          </Paper>
        ))}
      </SimpleGrid>
      {r.documentsUrl && (
        <Anchor href={r.documentsUrl} target="_blank" rel="noreferrer" size="sm">
          {t('p3:rfp.documents')}
        </Anchor>
      )}
      {r.alerts.map((a) => (
        <Alert key={a} color={a === 'INTERNAL_DUE' ? 'yellow' : 'red'} p="xs">
          {t(`p3:alert.${a}`)}
        </Alert>
      ))}
      <RuleErrors error={err} />

      <Paper withBorder p="sm">
        <Group justify="space-between">
          <Title order={6}>{t('p3:rfp.decision')}</Title>
          <Badge color={DECISION_COLOR[r.decision]}>{t(`p3:decision.${r.decision}`)}</Badge>
        </Group>
        {r.decidedOn && (
          <Text size="xs" c="dimmed">
            {fmtDate(r.decidedOn)} {r.decisionReason ? `· ${r.decisionReason}` : ''}
          </Text>
        )}
        {r.decision === 'PENDING' && canWrite && (
          <Group mt="xs" align="flex-end">
            <TextInput
              size="xs"
              label={t('fields.reason')}
              value={reason}
              onChange={(e) => setReason(e.currentTarget.value)}
            />
            <Button
              size="xs"
              color="green"
              onClick={() => decide.mutate('PARTICIPATE')}
              data-testid="rfp-participate"
            >
              {t('p3:decision.PARTICIPATE')}
            </Button>
            <Button size="xs" color="gray" variant="light" onClick={() => decide.mutate('DECLINE')}>
              {t('p3:decision.DECLINE')}
            </Button>
          </Group>
        )}
      </Paper>

      <Paper withBorder p="sm">
        <Group justify="space-between">
          <Title order={6}>{t('p3:rfp.matrix')}</Title>
          <Text size="sm">
            {r.compliance.answered}/{r.compliance.total} · {fmtPct(r.compliance.pct)}
          </Text>
        </Group>
        <Progress mt={4} value={(r.compliance.pct ?? 0) * 100} />
        <ScrollTable mt="xs" data-testid="rfp-matrix">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>#</Table.Th>
              <Table.Th>{t('p3:rfp.requirement')}</Table.Th>
              <Table.Th>{t('p3:rfp.answer')}</Table.Th>
              <Table.Th>{t('fields.comment')}</Table.Th>
              <Table.Th>{t('p3:rfp.assignee')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {r.requirements.map((x) => {
              const mine = x.assigneeUserId === me?.id;
              const editable = open && (canWrite || mine);
              return (
                <Table.Tr key={x.id}>
                  <Table.Td>{x.ref}</Table.Td>
                  <Table.Td>{x.requirement}</Table.Td>
                  <Table.Td>
                    {editable ? (
                      <Select
                        size="xs"
                        w={150}
                        data={COMPLIANCE_ANSWERS.map((a) => ({
                          value: a,
                          label: t(`p3:answer.${a}`),
                        }))}
                        value={x.answer}
                        onChange={(v) => v && patchReq.mutate({ reqId: x.id, body: { answer: v } })}
                      />
                    ) : (
                      <Badge color={ANSWER_COLOR[x.answer]} variant="light">
                        {t(`p3:answer.${x.answer}`)}
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td>
                    {editable ? (
                      <TextInput
                        size="xs"
                        defaultValue={x.comment ?? ''}
                        onBlur={(e) =>
                          e.currentTarget.value !== (x.comment ?? '') &&
                          patchReq.mutate({
                            reqId: x.id,
                            body: { comment: e.currentTarget.value || null },
                          })
                        }
                      />
                    ) : (
                      x.comment
                    )}
                  </Table.Td>
                  <Table.Td>
                    {open && canWrite ? (
                      <Select
                        size="xs"
                        w={170}
                        clearable
                        searchable
                        data={users}
                        value={x.assigneeUserId}
                        onChange={(v) =>
                          patchReq.mutate({ reqId: x.id, body: { assigneeUserId: v } })
                        }
                      />
                    ) : (
                      (x.assigneeName ?? '—')
                    )}
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </ScrollTable>
        {open && canWrite && (
          <SimpleGrid cols={{ base: 1, sm: 4 }} mt="xs">
            <TextInput
              size="xs"
              label="#"
              value={newReq.ref}
              onChange={(e) => setNewReq({ ...newReq, ref: e.currentTarget.value })}
            />
            <TextInput
              size="xs"
              label={t('p3:rfp.requirement')}
              value={newReq.requirement}
              onChange={(e) => setNewReq({ ...newReq, requirement: e.currentTarget.value })}
            />
            <Select
              size="xs"
              label={t('p3:rfp.assignee')}
              clearable
              searchable
              data={users}
              value={newReq.assigneeUserId || null}
              onChange={(v) => setNewReq({ ...newReq, assigneeUserId: v ?? '' })}
            />
            <Button
              size="xs"
              mt={22}
              onClick={() => addReq.mutate(undefined)}
              data-testid="rfp-add-req"
            >
              {t('actions.add')}
            </Button>
          </SimpleGrid>
        )}
      </Paper>

      <Paper withBorder p="sm">
        <Title order={6}>{t('p3:rfp.delivery')}</Title>
        <Text size="sm">
          {t('p3:rfp.cmReview')}:{' '}
          {r.cmReviewedAt ? fmtDate(r.cmReviewedAt.slice(0, 10)) : t('p3:rfp.notReviewed')}
        </Text>
        <Text size="sm">
          {t('p3:rfp.deliveredOn')}: {fmtDate(r.deliveredOn)}
        </Text>
        <Group mt="xs">
          {open && !r.cmReviewedAt && canDo(me, 'P3', 'approve') && (
            <Button size="xs" onClick={() => review.mutate(undefined)} data-testid="rfp-cm-review">
              {t('p3:rfp.approveFinal')}
            </Button>
          )}
          {open && canWrite && (
            <Button
              size="xs"
              color="green"
              onClick={() => deliver.mutate(undefined)}
              data-testid="rfp-deliver"
            >
              {t('p3:rfp.markDelivered')}
            </Button>
          )}
        </Group>
      </Paper>

      {r.deliveredOn && (
        <Paper withBorder p="sm">
          <Group justify="space-between">
            <Title order={6}>{t('p3:rfp.result')}</Title>
            <Badge>{t(`p3:result.${r.result}`)}</Badge>
          </Group>
          {r.winningCompetitor && <Text size="sm">{r.winningCompetitor}</Text>}
          {r.result === 'PENDING' && canWrite && (
            <SimpleGrid cols={{ base: 1, sm: 4 }} mt="xs">
              <Select
                size="xs"
                label={t('p3:rfp.result')}
                data={['WON', 'LOST', 'CANCELLED'].map((v) => ({
                  value: v,
                  label: t(`p3:result.${v}`),
                }))}
                value={result.result}
                onChange={(v) => v && setResult({ ...result, result: v })}
              />
              <TextInput
                size="xs"
                label={t('fields.winningCompetitor')}
                value={result.winningCompetitor}
                onChange={(e) => setResult({ ...result, winningCompetitor: e.currentTarget.value })}
              />
              <TextInput
                size="xs"
                label={t('fields.winningPrice')}
                value={result.winningPrice}
                onChange={(e) => setResult({ ...result, winningPrice: e.currentTarget.value })}
              />
              <Select
                size="xs"
                label={t('fields.currency')}
                data={[...CURRENCIES]}
                value={result.winningCurrency}
                onChange={(v) => v && setResult({ ...result, winningCurrency: v })}
              />
              <Button size="xs" onClick={() => saveResult.mutate(undefined)}>
                {t('actions.save')}
              </Button>
            </SimpleGrid>
          )}
        </Paper>
      )}
    </Stack>
  );
}

function NewRfp({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const opps = useQuery({
    queryKey: ['opportunities', 'rfp-picker'],
    queryFn: () =>
      api.get<{ id: string; code: string; name: string; status: string }[]>('/opportunities'),
  });
  const [v, setV] = useState({
    opportunityId: '',
    type: 'RFP',
    title: '',
    receivedOn: todayIso(),
    clientDeadline: '',
    documentsUrl: '',
  });
  const m = useAction(
    () =>
      api.post(`/opportunities/${v.opportunityId}/rfps`, {
        type: v.type,
        title: v.title,
        receivedOn: v.receivedOn,
        clientDeadline: v.clientDeadline,
        documentsUrl: v.documentsUrl || null,
      }),
    { invalidate: [['rfps']], onDone },
  );
  return (
    <Stack>
      <Select
        label={t('fields.name')}
        searchable
        data={(opps.data ?? [])
          .filter((o) => o.status === 'OPEN')
          .map((o) => ({ value: o.id, label: `${o.code} · ${o.name}` }))}
        value={v.opportunityId || null}
        onChange={(x) => setV({ ...v, opportunityId: x ?? '' })}
        data-testid="rfp-opportunity"
      />
      <Select
        label={t('fields.type')}
        data={[...RFP_TYPES]}
        value={v.type}
        onChange={(x) => x && setV({ ...v, type: x })}
      />
      <TextInput
        label={t('fields.title')}
        value={v.title}
        onChange={(e) => setV({ ...v, title: e.currentTarget.value })}
      />
      <SimpleGrid cols={2}>
        <TextInput
          type="date"
          label={t('p3:rfp.receivedOn')}
          value={v.receivedOn}
          onChange={(e) => setV({ ...v, receivedOn: e.currentTarget.value })}
        />
        <TextInput
          type="date"
          label={t('p3:rfp.clientDeadline')}
          value={v.clientDeadline}
          onChange={(e) => setV({ ...v, clientDeadline: e.currentTarget.value })}
        />
      </SimpleGrid>
      <TextInput
        label={t('p3:rfp.documents')}
        placeholder="https://"
        value={v.documentsUrl}
        onChange={(e) => setV({ ...v, documentsUrl: e.currentTarget.value })}
      />
      <Text size="xs" c="dimmed">
        {t('p3:rfp.datesHint')}
      </Text>
      <RuleErrors error={m.error} />
      <Button onClick={() => m.mutate(undefined)}>{t('actions.create')}</Button>
    </Stack>
  );
}

/** P3 Preventa: RFI/RFP list with KPIs "RFPs a tiempo" and win rate (KPIS.md §4). */
export default function PresalesPage() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const q = useQuery({
    queryKey: ['rfps'],
    queryFn: async () => {
      const res = await fetch('/api/v1/rfps', { credentials: 'same-origin' });
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as { data: Rfp[]; meta: { kpis: Kpis } };
    },
  });
  const k = q.data?.meta.kpis;
  return (
    <Stack>
      <PageHeader
        title={t('p3:title')}
        right={
          canDo(me, 'P3', 'write') && (
            <Button size="xs" onClick={() => setCreating(true)} data-testid="rfp-new">
              {t('p3:new')}
            </Button>
          )
        }
      />
      {k && (
        <SimpleGrid cols={{ base: 1, sm: 3 }} data-testid="rfp-kpis">
          <Paper withBorder p="sm">
            <Text size="xs" c="dimmed">
              {t('p3:kpi.onTime')}
            </Text>
            <Text fw={700} size="lg">
              {k.onTimePct === null ? '—' : fmtPct(k.onTimePct)}
            </Text>
            <Text size="xs" c="dimmed">
              {t('p3:kpi.delivered', { count: k.delivered })}
            </Text>
          </Paper>
          <Paper withBorder p="sm">
            <Text size="xs" c="dimmed">
              {t('p3:kpi.decisionOnTime')}
            </Text>
            <Text fw={700} size="lg">
              {k.decisionOnTimePct === null ? '—' : fmtPct(k.decisionOnTimePct)}
            </Text>
            <Text size="xs" c="dimmed">
              {t('p3:kpi.decided', { count: k.decided })}
            </Text>
          </Paper>
          <Paper withBorder p="sm">
            <Text size="xs" c="dimmed">
              {t('p3:kpi.winRate')}
            </Text>
            <Text fw={700} size="lg">
              {k.winRate === null ? '—' : fmtPct(k.winRate)}
            </Text>
            <Text size="xs" c="dimmed">
              {t('p3:kpi.withResult', { count: k.withResult })}
            </Text>
          </Paper>
        </SimpleGrid>
      )}
      <RuleErrors error={q.error} />
      <ScrollTable striped highlightOnHover withTableBorder data-testid="rfps-table">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('fields.title')}</Table.Th>
            <Table.Th>{t('p3:rfp.decision')}</Table.Th>
            <Table.Th>{t('p3:rfp.internalDeadline')}</Table.Th>
            <Table.Th>{t('p3:rfp.clientDeadline')}</Table.Th>
            <Table.Th>{t('p3:rfp.compliance')}</Table.Th>
            <Table.Th>{t('fields.status')}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {(q.data?.data ?? []).length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={6}>
                <Text c="dimmed" size="sm">
                  {t('ui.empty')}
                </Text>
              </Table.Td>
            </Table.Tr>
          )}
          {(q.data?.data ?? []).map((r) => (
            <Table.Tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(r.id)}>
              <Table.Td>
                <Text size="sm" fw={600}>
                  {r.type} · {r.title}
                </Text>
                <Text size="xs" c="dimmed">
                  {r.accountName} · {r.opportunityName}
                </Text>
              </Table.Td>
              <Table.Td>
                <Badge color={DECISION_COLOR[r.decision]} variant="light">
                  {t(`p3:decision.${r.decision}`)}
                </Badge>
                <Text size="xs" c="dimmed">
                  {t('p3:rfp.decisionDueOn')}: {fmtDate(r.decisionDueOn)}
                </Text>
              </Table.Td>
              <Table.Td>{fmtDate(r.internalDeadline)}</Table.Td>
              <Table.Td>{fmtDate(r.clientDeadline)}</Table.Td>
              <Table.Td>{r.compliancePct === null ? '—' : fmtPct(r.compliancePct)}</Table.Td>
              <Table.Td>
                <Group gap={4}>
                  {r.deliveredOn ? (
                    <Badge color="green" variant="light">
                      {t('p3:rfp.delivered')} {fmtDate(r.deliveredOn)}
                    </Badge>
                  ) : r.cmReviewedAt ? (
                    <Badge color="blue" variant="light">
                      {t('p3:rfp.reviewed')}
                    </Badge>
                  ) : null}
                  {r.result !== 'PENDING' && (
                    <Badge variant="outline">{t(`p3:result.${r.result}`)}</Badge>
                  )}
                  {r.alerts.map((a) => (
                    <Badge key={a} color={a === 'INTERNAL_DUE' ? 'yellow' : 'red'}>
                      {t(`p3:alert.${a}`)}
                    </Badge>
                  ))}
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </ScrollTable>
      <Drawer
        opened={Boolean(selected)}
        onClose={() => setSelected(null)}
        position="right"
        size="xl"
      >
        {selected && <RfpDetail id={selected} />}
      </Drawer>
      <Modal opened={creating} onClose={() => setCreating(false)} title={t('p3:new')}>
        <NewRfp onDone={() => setCreating(false)} />
      </Modal>
    </Stack>
  );
}
