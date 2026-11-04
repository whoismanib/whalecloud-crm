import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Checkbox,
  Chip,
  FileInput,
  Group,
  Modal,
  MultiSelect,
  Paper,
  ScrollArea,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { IconTrash } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CURRENCIES,
  edoIncidentRows,
  PROCESS_CODES,
  RACI_LETTERS,
  USER_ROLES,
  type ProcessCode,
  type RaciLetter,
  type UserRole,
  slimEdoIncidents,
} from '@wcrm/shared';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { canDo, useMe } from '../../auth/useMe';
import { RuleErrors } from '../../components/RuleErrors';
import { PageHeader, ScrollTable } from '../../components/ui';
import { fmtDate, fmtDateTime, todayIso } from '../../lib/format';
import { useAction } from '../../lib/mutations';
import { opt, useAccountsLite } from '../p2/lookups';

interface AdminUser {
  id: string;
  email: string;
  fullName: string;
  locale: string;
  isActive: boolean;
  lastLoginAt: string | null;
  roles: UserRole[];
}

function Users() {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api.get<AdminUser[]>('/admin/users'),
  });
  const [edit, setEdit] = useState<AdminUser | null>(null);
  const [creating, setCreating] = useState(false);
  const [nu, setNu] = useState({
    email: '',
    fullName: '',
    password: '',
    roles: [] as string[],
    locale: 'es-CL',
  });
  const inv = { invalidate: [['admin-users'], ['catalogs']] };
  const update = useAction(
    ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.patch(`/admin/users/${id}`, body),
    { ...inv, onDone: () => setEdit(null) },
  );
  const create = useAction(() => api.post('/admin/users', nu), {
    ...inv,
    onDone: () => setCreating(false),
  });
  const roleData = USER_ROLES.map((r) => ({ value: r, label: t(`enums:role.${r}`) }));
  return (
    <Stack>
      <Group justify="flex-end">
        <Button size="xs" onClick={() => setCreating(true)}>
          {t('p2:admin.newUser')}
        </Button>
      </Group>
      <RuleErrors error={q.error ?? update.error} />
      <ScrollTable striped withTableBorder data-testid="admin-users">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('fields.name')}</Table.Th>
            <Table.Th>{t('p2:admin.roles')}</Table.Th>
            <Table.Th>{t('p2:admin.lastLogin')}</Table.Th>
            <Table.Th>{t('p2:admin.active')}</Table.Th>
            <Table.Th />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {(q.data ?? []).map((u) => (
            <Table.Tr key={u.id}>
              <Table.Td>
                {u.fullName}
                <Text size="xs" c="dimmed">
                  {u.email} · {u.locale}
                </Text>
              </Table.Td>
              <Table.Td>
                <Group gap={4}>
                  {u.roles.map((r) => (
                    <Badge key={r} size="xs" variant="light">
                      {t(`enums:role.${r}`)}
                    </Badge>
                  ))}
                </Group>
              </Table.Td>
              <Table.Td>{fmtDateTime(u.lastLoginAt)}</Table.Td>
              <Table.Td>
                <Switch
                  size="xs"
                  checked={u.isActive}
                  onChange={(e) =>
                    update.mutate({ id: u.id, body: { isActive: e.currentTarget.checked } })
                  }
                />
              </Table.Td>
              <Table.Td>
                <Button size="compact-xs" variant="subtle" onClick={() => setEdit(u)}>
                  {t('actions.edit')}
                </Button>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </ScrollTable>
      <Modal opened={Boolean(edit)} onClose={() => setEdit(null)} title={edit?.fullName}>
        {edit && (
          <Stack>
            <MultiSelect
              label={t('p2:admin.roles')}
              data={roleData}
              value={edit.roles}
              onChange={(v) => setEdit({ ...edit, roles: v as UserRole[] })}
            />
            <TextInput label={t('p2:admin.newPassword')} type="password" id="pw" />
            <RuleErrors error={update.error} />
            <Button
              onClick={() => {
                const pw = (document.getElementById('pw') as HTMLInputElement | null)?.value;
                update.mutate({
                  id: edit.id,
                  body: { roles: edit.roles, ...(pw ? { password: pw } : {}) },
                });
              }}
            >
              {t('actions.save')}
            </Button>
          </Stack>
        )}
      </Modal>
      <Modal opened={creating} onClose={() => setCreating(false)} title={t('p2:admin.newUser')}>
        <Stack>
          <TextInput
            label={t('fields.email')}
            value={nu.email}
            onChange={(e) => setNu({ ...nu, email: e.currentTarget.value })}
          />
          <TextInput
            label={t('fields.name')}
            value={nu.fullName}
            onChange={(e) => setNu({ ...nu, fullName: e.currentTarget.value })}
          />
          <TextInput
            label={t('p2:admin.newPassword')}
            type="password"
            value={nu.password}
            onChange={(e) => setNu({ ...nu, password: e.currentTarget.value })}
          />
          <MultiSelect
            label={t('p2:admin.roles')}
            data={roleData}
            value={nu.roles}
            onChange={(v) => setNu({ ...nu, roles: v })}
          />
          <Select
            label={t('ui.language')}
            data={['es-CL', 'en', 'zh-CN']}
            value={nu.locale}
            onChange={(v) => v && setNu({ ...nu, locale: v })}
          />
          <RuleErrors error={create.error} />
          <Button onClick={() => create.mutate(undefined)}>{t('actions.create')}</Button>
        </Stack>
      </Modal>
    </Stack>
  );
}

function Raci() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['admin-raci'],
    queryFn: () =>
      api.get<{
        active: { version: number; comment: string; createdAt: string };
        versions: {
          id: number;
          version: number;
          isActive: boolean;
          createdAt: string;
          comment: string;
        }[];
        entries: { process: ProcessCode; role: UserRole; letters: RaciLetter[] }[];
      }>('/admin/raci'),
  });
  const [changes, setChanges] = useState<Record<string, RaciLetter[]>>({});
  const [comment, setComment] = useState('');
  const base = useMemo(
    () =>
      Object.fromEntries((q.data?.entries ?? []).map((e) => [`${e.process}|${e.role}`, e.letters])),
    [q.data],
  );
  const save = useAction(
    () =>
      api.put('/admin/raci', {
        comment,
        entries: Object.entries(changes).map(([k, letters]) => {
          const [process, role] = k.split('|');
          return { process, role, letters };
        }),
      }),
    {
      invalidate: [['admin-raci'], ['me']],
      onDone: () => {
        setChanges({});
        setComment('');
        void qc.invalidateQueries({ queryKey: ['me'] });
      },
    },
  );
  const cell = (p: string, r: string) => changes[`${p}|${r}`] ?? base[`${p}|${r}`] ?? [];
  return (
    <Stack>
      {q.data && (
        <Text size="sm" c="dimmed">
          v{q.data.active.version} · {q.data.active.comment} ·{' '}
          {fmtDateTime(q.data.active.createdAt)}
        </Text>
      )}
      <ScrollArea>
        <ScrollTable withTableBorder withColumnBorders data-testid="raci-grid" fz="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th />
              {USER_ROLES.map((r) => (
                <Table.Th key={r}>{t(`enums:role.${r}`)}</Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {PROCESS_CODES.map((p) => (
              <Table.Tr key={p}>
                <Table.Td fw={600}>{p}</Table.Td>
                {USER_ROLES.map((r) => {
                  const v = cell(p, r);
                  const changed = `${p}|${r}` in changes;
                  return (
                    <Table.Td
                      key={r}
                      bg={changed ? 'var(--mantine-color-yellow-light)' : undefined}
                    >
                      <Chip.Group
                        multiple
                        value={v}
                        onChange={(x) =>
                          setChanges((c) => ({ ...c, [`${p}|${r}`]: x as RaciLetter[] }))
                        }
                      >
                        <Group gap={2} wrap="nowrap">
                          {RACI_LETTERS.map((l) => (
                            <Chip key={l} value={l} size="xs" variant="outline">
                              {l}
                            </Chip>
                          ))}
                        </Group>
                      </Chip.Group>
                    </Table.Td>
                  );
                })}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </ScrollTable>
      </ScrollArea>
      <Group align="flex-end">
        <TextInput
          size="xs"
          w={360}
          label={t('fields.comment')}
          value={comment}
          onChange={(e) => setComment(e.currentTarget.value)}
        />
        <Button
          size="xs"
          disabled={!Object.keys(changes).length}
          onClick={() => save.mutate(undefined)}
        >
          {t('p2:admin.publishRaci', { count: Object.keys(changes).length })}
        </Button>
      </Group>
      <RuleErrors error={save.error} />
      <Text size="xs" c="dimmed">
        {t('p2:admin.raciHint')}
      </Text>
    </Stack>
  );
}

function Settings() {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['admin-settings'],
    queryFn: () => api.get<{ key: string; value: unknown }[]>('/admin/settings'),
  });
  const [edit, setEdit] = useState<{ key: string; text: string; reason: string } | null>(null);
  const [filter, setFilter] = useState('');
  const hist = useQuery({
    queryKey: ['admin-setting-history', edit?.key],
    queryFn: () =>
      api.get<{ id: number; value: unknown; changedAt: string }[]>(
        `/admin/settings/${encodeURIComponent(edit!.key)}/history`,
      ),
    enabled: Boolean(edit),
  });
  const [parseErr, setParseErr] = useState<string | null>(null);
  const save = useAction(
    () => {
      let value: unknown;
      try {
        value = JSON.parse(edit!.text);
      } catch {
        setParseErr(t('p2:admin.invalidJson'));
        return Promise.reject(new Error('json'));
      }
      setParseErr(null);
      return api.put(`/admin/settings/${encodeURIComponent(edit!.key)}`, {
        value,
        reason: edit!.reason,
      });
    },
    { invalidate: [['admin-settings'], ['settings']], onDone: () => setEdit(null) },
  );
  const rows = (q.data ?? []).filter((s) => s.key.toLowerCase().includes(filter.toLowerCase()));
  return (
    <Stack>
      <TextInput
        size="xs"
        w={280}
        placeholder={t('actions.search')}
        value={filter}
        onChange={(e) => setFilter(e.currentTarget.value)}
      />
      <ScrollTable striped withTableBorder data-testid="admin-settings">
        <Table.Tbody>
          {rows.map((s) => (
            <Table.Tr key={s.key}>
              <Table.Td fw={600} w={320}>
                <Text size="sm">{s.key}</Text>
                <Text size="xs" c="dimmed">
                  {t(`p2:settings.${s.key.replace(/\./g, '_')}`, { defaultValue: '' })}
                </Text>
              </Table.Td>
              <Table.Td>
                <Text size="xs" ff="monospace" style={{ wordBreak: 'break-all' }}>
                  {JSON.stringify(s.value)}
                </Text>
              </Table.Td>
              <Table.Td w={80}>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  onClick={() =>
                    setEdit({ key: s.key, text: JSON.stringify(s.value, null, 2), reason: '' })
                  }
                >
                  {t('actions.edit')}
                </Button>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </ScrollTable>
      <Modal opened={Boolean(edit)} onClose={() => setEdit(null)} title={edit?.key} size="lg">
        {edit && (
          <Stack>
            <Textarea
              autosize
              minRows={4}
              ff="monospace"
              value={edit.text}
              onChange={(e) => setEdit({ ...edit, text: e.currentTarget.value })}
            />
            <TextInput
              label={t('fields.reason')}
              value={edit.reason}
              onChange={(e) => setEdit({ ...edit, reason: e.currentTarget.value })}
            />
            {parseErr && <Alert color="red">{parseErr}</Alert>}
            <RuleErrors
              error={
                save.error instanceof Error && save.error.message === 'json'
                  ? undefined
                  : save.error
              }
            />
            <Button onClick={() => save.mutate(undefined)}>{t('actions.save')}</Button>
            <Title order={6}>{t('p2:admin.history')}</Title>
            {(hist.data ?? []).map((h) => (
              <Text key={h.id} size="xs" ff="monospace">
                {fmtDateTime(h.changedAt)} · {JSON.stringify(h.value)}
              </Text>
            ))}
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}

function Fx() {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['fx-rates'],
    queryFn: () =>
      api.get<
        {
          month: string;
          currency: string;
          kind: string;
          unitsPerUsd: string;
          source: string | null;
        }[]
      >('/fx-rates'),
  });
  const [v, setV] = useState({
    month: `${todayIso().slice(0, 7)}-01`,
    currency: 'CLP',
    unitsPerUsd: '',
    kind: 'ACTUAL',
    source: '',
  });
  const m = useAction(() => api.post('/fx-rates', { ...v, source: v.source || null }), {
    invalidate: [['fx-rates']],
  });
  return (
    <Stack>
      <Paper withBorder p="sm">
        <SimpleGrid cols={{ base: 2, md: 6 }}>
          <TextInput
            size="xs"
            type="date"
            label={t('p2:capacity.month')}
            value={v.month}
            onChange={(e) => setV({ ...v, month: e.currentTarget.value })}
          />
          <Select
            size="xs"
            label={t('fields.currency')}
            data={CURRENCIES.filter((c) => c !== 'USD')}
            value={v.currency}
            onChange={(x) => x && setV({ ...v, currency: x })}
          />
          <TextInput
            size="xs"
            label={t('p2:admin.unitsPerUsd')}
            value={v.unitsPerUsd}
            onChange={(e) => setV({ ...v, unitsPerUsd: e.currentTarget.value })}
          />
          <Select
            size="xs"
            label={t('fields.type')}
            data={['ACTUAL', 'BUDGET']}
            value={v.kind}
            onChange={(x) => x && setV({ ...v, kind: x })}
          />
          <TextInput
            size="xs"
            label={t('p2:admin.source')}
            value={v.source}
            onChange={(e) => setV({ ...v, source: e.currentTarget.value })}
          />
          <Button size="xs" mt={22} onClick={() => m.mutate(undefined)}>
            {t('actions.save')}
          </Button>
        </SimpleGrid>
        <RuleErrors error={m.error} />
      </Paper>
      <ScrollTable striped withTableBorder data-testid="fx-table">
        <Table.Tbody>
          {(q.data ?? []).map((r) => (
            <Table.Tr key={`${r.month}${r.currency}${r.kind}`}>
              <Table.Td>{r.month.slice(0, 7)}</Table.Td>
              <Table.Td>{r.currency}</Table.Td>
              <Table.Td>{r.kind}</Table.Td>
              <Table.Td>{r.unitsPerUsd}</Table.Td>
              <Table.Td>{r.source}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </ScrollTable>
    </Stack>
  );
}

function Calendars() {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['admin-calendars'],
    queryFn: () =>
      api.get<
        {
          id: string;
          name: string;
          holidays: { date: string; name: string; isWorkday: boolean }[];
        }[]
      >('/admin/calendars'),
  });
  const [cal, setCal] = useState('CL');
  const [h, setH] = useState({ date: '', name: '', isWorkday: false });
  const inv = { invalidate: [['admin-calendars']] };
  const add = useAction(() => api.post(`/admin/calendars/${cal}/holidays`, h), inv);
  const del = useAction((date: string) => api.del(`/admin/calendars/${cal}/holidays/${date}`), inv);
  const current = (q.data ?? []).find((c) => c.id === cal);
  return (
    <Stack>
      <Group align="flex-end">
        <Select
          size="xs"
          label={t('p2:admin.calendar')}
          data={(q.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
          value={cal}
          onChange={(v) => v && setCal(v)}
        />
        <TextInput
          size="xs"
          type="date"
          label={t('fields.date')}
          value={h.date}
          onChange={(e) => setH({ ...h, date: e.currentTarget.value })}
        />
        <TextInput
          size="xs"
          label={t('fields.name')}
          value={h.name}
          onChange={(e) => setH({ ...h, name: e.currentTarget.value })}
        />
        <Checkbox
          size="xs"
          label={t('p2:admin.workday')}
          checked={h.isWorkday}
          onChange={(e) => setH({ ...h, isWorkday: e.currentTarget.checked })}
        />
        <Button size="xs" onClick={() => add.mutate(undefined)}>
          {t('actions.add')}
        </Button>
      </Group>
      <RuleErrors error={add.error ?? del.error} />
      <ScrollTable striped withTableBorder data-testid="holidays">
        <Table.Tbody>
          {(current?.holidays ?? []).map((x) => (
            <Table.Tr key={x.date}>
              <Table.Td>{fmtDate(x.date)}</Table.Td>
              <Table.Td>{x.name}</Table.Td>
              <Table.Td>{x.isWorkday ? t('p2:admin.workday') : ''}</Table.Td>
              <Table.Td w={40}>
                <ActionIcon
                  size="sm"
                  color="red"
                  variant="subtle"
                  aria-label="delete"
                  onClick={() => del.mutate(x.date)}
                >
                  <IconTrash size={14} />
                </ActionIcon>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </ScrollTable>
    </Stack>
  );
}

interface ImportResult {
  id: string;
  dryRun: boolean;
  rowsTotal: number;
  rowsOk: number;
  created: Record<string, number>;
  skipped: number;
  errors: ImportIssue[];
  updated?: Record<string, number>;
  warnings?: ImportIssue[];
}
type ImportIssue = { row: number; source?: string; code: string; params?: Record<string, unknown> };
type ImportKindKey = 'accounts' | 'opportunities' | 'invoices' | 'legacy-tracker' | 'edo-incidents';
const JSON_KINDS: ImportKindKey[] = ['legacy-tracker', 'edo-incidents'];

function ImportIssues({ items, color }: { items: ImportIssue[]; color: string }) {
  const { t } = useTranslation();
  return (
    <>
      {items.slice(0, 30).map((e, i) => (
        <Text key={i} size="xs" c={color}>
          {e.source ? `${e.source} ` : ''}#{e.row}:{' '}
          {t(`errors:rules.${e.code}`, { ...e.params, defaultValue: e.code })}
        </Text>
      ))}
      {items.length > 30 && (
        <Text size="xs" c={color}>
          … +{items.length - 30}
        </Text>
      )}
    </>
  );
}

function Imports() {
  const { t } = useTranslation();
  const [kind, setKind] = useState<ImportKindKey>('legacy-tracker');
  const [file, setFile] = useState<File | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const accounts = useAccountsLite(kind === 'edo-incidents');
  const [dryRun, setDryRun] = useState(true);
  const [result, setResult] = useState<ImportResult | null>(null);
  const jobs = useQuery({
    queryKey: ['imports'],
    queryFn: () =>
      api.get<
        {
          id: string;
          kind: string;
          dryRun: boolean;
          rowsTotal: number;
          rowsOk: number;
          rowsError: number;
          createdAt: string;
        }[]
      >('/imports'),
  });
  const run = useAction(
    async () => {
      const text = await file!.text();
      let body: Record<string, unknown>;
      if (kind === 'edo-incidents') {
        // Send only the fields the importer reads (the legacy file is ~4 MB with comments).
        const rows = edoIncidentRows(JSON.parse(text));
        body = { data: slimEdoIncidents(rows ?? []), dryRun, ...(accountId && { accountId }) };
      } else if (kind === 'legacy-tracker') body = { data: JSON.parse(text), dryRun };
      else body = { csv: text, dryRun };
      return api.post<ImportResult>(`/imports/${kind}`, body);
    },
    {
      invalidate: [
        ['imports'],
        ['accounts'],
        ['opportunities'],
        ['invoices'],
        ['tickets'],
        ['dashboard'],
      ],
      onDone: setResult,
    },
  );
  return (
    <Stack>
      <Paper withBorder p="sm">
        <Group align="flex-end">
          <Select
            size="xs"
            label={t('fields.type')}
            data={(
              ['legacy-tracker', 'edo-incidents', 'accounts', 'opportunities', 'invoices'] as const
            ).map((k) => ({ value: k, label: t(`p2:import.kinds.${k}`) }))}
            value={kind}
            onChange={(v) => v && setKind(v as typeof kind)}
            data-testid="import-kind"
          />
          {kind === 'edo-incidents' && (
            <Select
              size="xs"
              w={220}
              label={t('p2:import.account')}
              placeholder={t('p2:import.accountDefault')}
              data={opt(accounts.data)}
              value={accountId}
              onChange={setAccountId}
              searchable
              clearable
            />
          )}
          <FileInput
            size="xs"
            w={260}
            label={t('p2:import.file')}
            accept={JSON_KINDS.includes(kind) ? '.json,application/json' : '.csv,text/csv'}
            value={file}
            onChange={setFile}
            data-testid="import-file"
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
            onClick={() => run.mutate(undefined)}
            data-testid="import-run"
          >
            {t('p2:import.run')}
          </Button>
        </Group>
        {!JSON_KINDS.includes(kind) && (
          <Anchor size="xs" href={`/api/v1/imports/templates/${kind}`}>
            {t('p2:import.template')}
          </Anchor>
        )}
        <Text size="xs" c="dimmed" mt={4}>
          {t(
            kind === 'legacy-tracker'
              ? 'p2:import.legacyHint'
              : kind === 'edo-incidents'
                ? 'p2:import.edoHint'
                : 'p2:import.csvHint',
          )}
        </Text>
      </Paper>
      <RuleErrors error={run.error} />
      {result && (
        <Alert
          color={result.errors.length ? 'yellow' : 'green'}
          title={result.dryRun ? t('p2:import.simulated') : t('p2:import.applied')}
          data-testid="import-result"
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
          {result.updated && Object.keys(result.updated).length > 0 && (
            <Text size="sm" data-testid="import-updated">
              {t('p2:import.updatedLabel')}:{' '}
              {Object.entries(result.updated)
                .map(([k, n]) => `${t(`p2:import.updated.${k}`, { defaultValue: k })}: ${n}`)
                .join(' · ')}
            </Text>
          )}
          <ImportIssues items={result.errors} color="red" />
          {!!result.warnings?.length && (
            <>
              <Text size="xs" fw={600} mt={4}>
                {t('p2:import.warnings')} ({result.warnings.length})
              </Text>
              <ImportIssues items={result.warnings} color="orange" />
            </>
          )}
        </Alert>
      )}
      <Title order={6}>{t('p2:admin.history')}</Title>
      <ScrollTable striped withTableBorder fz="xs">
        <Table.Tbody>
          {(jobs.data ?? []).map((j) => (
            <Table.Tr key={j.id}>
              <Table.Td>{fmtDateTime(j.createdAt)}</Table.Td>
              <Table.Td>{j.kind}</Table.Td>
              <Table.Td>{j.dryRun ? t('p2:import.dryRun') : ''}</Table.Td>
              <Table.Td>
                {j.rowsOk}/{j.rowsTotal} · {j.rowsError} ✗
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </ScrollTable>
    </Stack>
  );
}

function Jobs() {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['admin-jobs'],
    queryFn: () => api.get<{ name: string; cron: string; description: string }[]>('/admin/jobs'),
  });
  const [out, setOut] = useState<string>('');
  const run = useAction((name: string) => api.post<unknown>(`/admin/jobs/${name}/run`), {
    invalidate: [['notifications']],
    onDone: (r) => setOut(JSON.stringify(r, null, 2)),
  });
  return (
    <Stack>
      <Text size="xs" c="dimmed">
        {t('p2:admin.jobsHint')}
      </Text>
      <ScrollTable striped withTableBorder data-testid="admin-jobs">
        <Table.Tbody>
          {(q.data ?? []).map((j) => (
            <Table.Tr key={j.name}>
              <Table.Td ff="monospace">{j.name}</Table.Td>
              <Table.Td ff="monospace">{j.cron}</Table.Td>
              <Table.Td>
                {t(`p2:jobs.${j.name.replace('.', '_')}`, { defaultValue: j.description })}
              </Table.Td>
              <Table.Td w={90}>
                <Button size="compact-xs" onClick={() => run.mutate(j.name)}>
                  {t('p2:admin.run')}
                </Button>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </ScrollTable>
      <RuleErrors error={run.error} />
      {out && (
        <Text size="xs" ff="monospace" style={{ whiteSpace: 'pre-wrap' }} data-testid="job-output">
          {out}
        </Text>
      )}
    </Stack>
  );
}

/** ADM: users/roles, editable RACI, settings, monthly FX, holiday calendars, imports, jobs. */
export default function AdminPage() {
  const { t } = useTranslation();
  const { data: me } = useMe();
  const admin = canDo(me, 'ADM', 'write');
  const importer = admin || canDo(me, 'P1', 'approve');
  const fx = Boolean(me?.actionRoles?.['FX.write']);
  const tabs = [
    admin && 'users',
    admin && 'raci',
    admin && 'settings',
    fx && 'fx',
    admin && 'calendars',
    importer && 'import',
    admin && 'jobs',
  ].filter(Boolean) as string[];
  if (!tabs.length) return <Alert>{t('ui.readOnly')}</Alert>;
  return (
    <Stack>
      <PageHeader title={t('p2:admin.title')} />
      <Tabs defaultValue={tabs[0]} keepMounted={false}>
        <Tabs.List>
          {tabs.map((k) => (
            <Tabs.Tab key={k} value={k}>
              {t(`p2:admin.tabs.${k}`)}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        <Tabs.Panel value="users" pt="md">
          <Users />
        </Tabs.Panel>
        <Tabs.Panel value="raci" pt="md">
          <Raci />
        </Tabs.Panel>
        <Tabs.Panel value="settings" pt="md">
          <Settings />
        </Tabs.Panel>
        <Tabs.Panel value="fx" pt="md">
          <Fx />
        </Tabs.Panel>
        <Tabs.Panel value="calendars" pt="md">
          <Calendars />
        </Tabs.Panel>
        <Tabs.Panel value="import" pt="md">
          <Imports />
        </Tabs.Panel>
        <Tabs.Panel value="jobs" pt="md">
          <Jobs />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
