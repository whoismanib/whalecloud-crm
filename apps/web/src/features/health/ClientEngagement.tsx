import {
  Accordion,
  Alert,
  Badge,
  Button,
  FileInput,
  Group,
  Modal,
  SegmentedControl,
  Stack,
  Switch,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { canDo, useMe } from '../../auth/useMe';
import { RuleErrors } from '../../components/RuleErrors';
import { EnumBadge, ScrollTable } from '../../components/ui';
import { fmtDate, fmtDateTime } from '../../lib/format';
import { useAction } from '../../lib/mutations';

export interface EngagementTopic {
  id: string;
  name: string;
  section: string;
  state: string;
  stateReason: string | null;
  opportunityId: string | null;
  opportunityCode: string | null;
  inbox: number;
  sent: number;
  meetings: number;
  upcoming: number;
  lastDays: number;
  nextMeetingAt: string | null;
  score: number;
  status: string;
  active: boolean;
  reason: { code: string; params?: Record<string, unknown> } | null;
}
export interface EngagementAccount {
  accountId: string;
  accountName: string;
  score: number;
  activeCount: number;
  totalCount: number;
  emails: number;
  meetings: number;
  upcoming: number;
  onHold: number;
  closed: number;
  topics: EngagementTopic[];
}
export interface Engagement {
  scope: 'mine' | 'all';
  asOf: string;
  windowDays: number;
  mailbox: {
    generatedAt: string;
    emails: number;
    meetings: number;
    upcoming: number;
    unmatched: number;
  } | null;
  summary: {
    active: number;
    healthy: number;
    atRisk: number;
    critical: number;
    stale: number;
    onHold: number;
  };
  accounts: EngagementAccount[];
}

const GLOBAL = ['COUNTRY_MANAGER', 'LATAM_PRESIDENT', 'ADMIN'];
export const scoreColor = (s: number | null) =>
  s === null ? undefined : s >= 70 ? 'green' : s >= 40 ? 'yellow.7' : 'red';

export function useEngagement(scope: 'mine' | 'all' = 'mine') {
  return useQuery({
    queryKey: ['engagement', scope],
    queryFn: () => api.get<Engagement>(`/dashboard/engagement?scope=${scope}`),
  });
}

interface MailImportResult {
  dryRun: boolean;
  rowsTotal: number;
  rowsOk: number;
  skipped: number;
  created: Record<string, number>;
  replacedActivities: number;
  linkedOpportunities: number;
  errors: { row: number; source?: string; code: string; params?: Record<string, unknown> }[];
}

function MailImport({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [result, setResult] = useState<MailImportResult | null>(null);
  const run = useAction(
    async () =>
      api.post<MailImportResult>('/mail/legacy-cache', {
        data: JSON.parse(await file!.text()),
        dryRun,
      }),
    { invalidate: [['engagement'], ['health'], ['dashboard']], onDone: setResult },
  );
  return (
    <Modal opened={opened} onClose={onClose} title={t('health.import.title')} size="lg">
      <Stack>
        <Text size="xs" c="dimmed">
          {t('health.import.hint')}
        </Text>
        <Group align="flex-end">
          <FileInput
            size="xs"
            w={260}
            label={t('p2:import.file')}
            accept=".json,application/json"
            value={file}
            onChange={setFile}
            data-testid="mail-import-file"
          />
          <Switch
            size="sm"
            label={t('p2:import.dryRun')}
            checked={dryRun}
            onChange={(e) => setDryRun(e.currentTarget.checked)}
          />
          <Button
            size="xs"
            disabled={!file}
            loading={run.isPending}
            onClick={() => run.mutate(undefined)}
            data-testid="mail-import-run"
          >
            {t('p2:import.run')}
          </Button>
        </Group>
        <RuleErrors error={run.error} />
        {result && (
          <Alert
            color={result.errors.length ? 'yellow' : 'green'}
            title={result.dryRun ? t('p2:import.simulated') : t('p2:import.applied')}
            data-testid="mail-import-result"
          >
            <Text size="sm">
              {t('p2:import.summary', {
                ok: result.rowsOk,
                total: result.rowsTotal,
                skipped: result.skipped,
              })}
            </Text>
            <Text size="sm">
              {Object.entries(result.created)
                .map(([k, n]) => `${t(`p2:import.created.${k}`, { defaultValue: k })}: ${n}`)
                .join(' · ')}
            </Text>
            <Text size="xs">
              {t('health.import.linked', { count: result.linkedOpportunities })}
              {result.replacedActivities > 0 &&
                ` · ${t('health.import.replaced', { count: result.replacedActivities })}`}
            </Text>
            {result.errors.slice(0, 30).map((e, i) => (
              <Text key={i} size="xs" c="yellow.8">
                {t(`errors:rules.${e.code}`, { ...e.params, defaultValue: e.code })}
              </Text>
            ))}
          </Alert>
        )}
      </Stack>
    </Modal>
  );
}

/** Legacy "Salud por cliente": engagement score per account from mail and meetings (ADR 0008). */
export function ClientEngagement() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const global = (me?.roles ?? []).some((r) => GLOBAL.includes(r));
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [importing, setImporting] = useState(false);
  const q = useEngagement(scope);
  const d = q.data;
  return (
    <Stack gap="xs" data-testid="client-engagement">
      <Group justify="space-between">
        <Title order={4}>{t('health.byClient')}</Title>
        <Group gap="xs">
          {global && (
            <SegmentedControl
              size="xs"
              value={scope}
              onChange={(v) => setScope(v as 'mine' | 'all')}
              data={[
                { value: 'mine', label: me?.fullName ?? 'Yo' },
                { value: 'all', label: t('health.allMailboxes') },
              ]}
            />
          )}
          {canDo(me, 'P1', 'write') && (
            <Button size="xs" variant="light" onClick={() => setImporting(true)}>
              {t('health.import.button')}
            </Button>
          )}
        </Group>
      </Group>
      <RuleErrors error={q.error} />
      {d?.mailbox && (
        <Text size="xs" c="dimmed">
          {t('health.mailbox', {
            emails: d.mailbox.emails,
            meetings: d.mailbox.meetings,
            upcoming: d.mailbox.upcoming,
            unmatched: d.mailbox.unmatched,
            date: fmtDateTime(d.mailbox.generatedAt),
          })}
        </Text>
      )}
      {d && !d.accounts.length && (
        <Text size="sm" c="dimmed">
          {t('health.noMail')}
        </Text>
      )}
      {d && d.accounts.length > 0 && (
        <Accordion variant="contained" multiple>
          {d.accounts.map((a) => (
            <Accordion.Item key={a.accountId} value={a.accountId}>
              <Accordion.Control>
                <Group justify="space-between" wrap="nowrap" pr="sm">
                  <Stack gap={0}>
                    <Text fw={700}>{a.accountName}</Text>
                    <Text size="xs" c="dimmed">
                      {t('health.clientLine', {
                        active: a.activeCount,
                        total: a.totalCount,
                        emails: a.emails,
                        meetings: a.meetings,
                      })}
                    </Text>
                  </Stack>
                  <Text fz={22} fw={700} c={scoreColor(a.score)} data-testid="client-score">
                    {a.score}
                    <Text span size="xs" c="dimmed">
                      /100
                    </Text>
                  </Text>
                </Group>
              </Accordion.Control>
              <Accordion.Panel>
                <ScrollTable striped withTableBorder fz="xs" minWidth={960}>
                  <Table.Thead>
                    <Table.Tr style={{ whiteSpace: 'nowrap' }}>
                      <Table.Th w="30%">{t('health.topic')}</Table.Th>
                      <Table.Th>{t('health.score')}</Table.Th>
                      <Table.Th>{t('fields.status')}</Table.Th>
                      <Table.Th>{t('health.mail30d')}</Table.Th>
                      <Table.Th>{t('health.meetings30d')}</Table.Th>
                      <Table.Th>{t('health.lastMove')}</Table.Th>
                      <Table.Th>{t('health.reasons')}</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {a.topics.map((tp) => (
                      <Table.Tr key={tp.id} style={{ verticalAlign: 'top' }}>
                        <Table.Td>
                          <Text size="xs" fw={500}>
                            {tp.name}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {tp.section}
                            {tp.opportunityId && (
                              <>
                                {' · '}
                                <Link to={`/oportunidades/${tp.opportunityId}`}>
                                  {tp.opportunityCode}
                                </Link>
                              </>
                            )}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="xs" fw={700} c={tp.active ? scoreColor(tp.score) : 'dimmed'}>
                            {tp.score}
                          </Text>
                        </Table.Td>
                        <Table.Td style={{ whiteSpace: 'nowrap' }}>
                          <EnumBadge ns="engagement" value={tp.status} size="xs" />
                        </Table.Td>
                        <Table.Td style={{ whiteSpace: 'nowrap' }}>
                          {tp.inbox + tp.sent > 0 ? `${tp.inbox} ↓ · ${tp.sent} ↑` : '—'}
                        </Table.Td>
                        <Table.Td style={{ whiteSpace: 'nowrap' }}>
                          {tp.meetings || '—'}
                          {tp.upcoming > 0 && (
                            <Badge size="xs" variant="light" ml={4}>
                              +{tp.upcoming}
                            </Badge>
                          )}
                        </Table.Td>
                        <Table.Td style={{ whiteSpace: 'nowrap' }}>
                          {tp.lastDays < 999 ? t('health.daysAgo', { days: tp.lastDays }) : '—'}
                          {tp.nextMeetingAt && (
                            <Text size="xs" c="dimmed">
                              {t('health.nextMeeting', { date: fmtDate(tp.nextMeetingAt) })}
                            </Text>
                          )}
                        </Table.Td>
                        <Table.Td maw={320}>
                          {tp.reason
                            ? t(`health.topicReason.${tp.reason.code}`, tp.reason.params ?? {})
                            : ''}
                          {tp.stateReason && (
                            <Text size="xs" c="dimmed" lineClamp={2}>
                              {tp.stateReason}
                            </Text>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </ScrollTable>
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
      )}
      <MailImport opened={importing} onClose={() => setImporting(false)} />
    </Stack>
  );
}
