import {
  Alert,
  Badge,
  Button,
  Code,
  Group,
  Pagination,
  Select,
  Stack,
  Table,
  Text,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { AUDIT_CATEGORIES } from '@wcrm/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../api/client';
import { RuleErrors } from '../../components/RuleErrors';
import { PageHeader, ScrollTable } from '../../components/ui';
import { fmtDateTime } from '../../lib/format';
import { ChangesCell, type AuditRow } from '../opportunities/tabs/TimelineTab';

export default function AuditPage() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['audit', page, category],
    queryFn: async () => {
      const res = await fetch(
        `/api/v1/audit-log?page=${page}&pageSize=50${category ? `&category=${category}` : ''}`,
        { credentials: 'same-origin' },
      );
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as {
        data: (AuditRow & { hash: string })[];
        meta: { total: number };
      };
    },
  });
  const [verify, setVerify] = useState<{
    ok: boolean;
    checked: number;
    firstBrokenId: string | null;
  } | null>(null);
  const runVerify = async () => setVerify(await api.get('/audit-log/verify'));
  return (
    <Stack>
      <PageHeader
        title={t('audit.title')}
        right={
          <>
            <Select
              size="xs"
              clearable
              placeholder={t('audit.category')}
              data={AUDIT_CATEGORIES.map((c) => ({
                value: c,
                label: t(`enums:auditCategory.${c}`),
              }))}
              value={category}
              onChange={(v) => {
                setCategory(v);
                setPage(1);
              }}
            />
            <Button size="xs" variant="light" onClick={runVerify} data-testid="verify-chain">
              {t('audit.verify')}
            </Button>
          </>
        }
      />
      {verify && (
        <Alert color={verify.ok ? 'green' : 'red'}>
          {verify.ok
            ? t('audit.verified', { count: verify.checked })
            : t('audit.broken', { id: verify.firstBrokenId })}
        </Alert>
      )}
      <RuleErrors error={q.error} />
      <ScrollTable striped withTableBorder data-testid="audit-table">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>#</Table.Th>
            <Table.Th>{t('audit.occurredAt')}</Table.Th>
            <Table.Th>{t('audit.actor')}</Table.Th>
            <Table.Th>{t('audit.category')}</Table.Th>
            <Table.Th>{t('audit.action')}</Table.Th>
            <Table.Th>{t('audit.entity')}</Table.Th>
            <Table.Th>{t('audit.changes')}</Table.Th>
            <Table.Th>hash</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {(q.data?.data ?? []).map((r) => (
            <Table.Tr key={r.id}>
              <Table.Td>{r.id}</Table.Td>
              <Table.Td>{fmtDateTime(r.occurredAt)}</Table.Td>
              <Table.Td>{r.actorName ?? 'sistema'}</Table.Td>
              <Table.Td>
                <Badge variant="light">{t(`enums:auditCategory.${r.category}`)}</Badge>
              </Table.Td>
              <Table.Td>{t(`enums:auditAction.${r.action}`)}</Table.Td>
              <Table.Td>
                <Text size="xs">{r.entityType}</Text>
              </Table.Td>
              <Table.Td>
                <ChangesCell changes={r.changes} />
                {r.reason && (
                  <Text size="xs" c="dimmed">
                    {r.reason}
                  </Text>
                )}
              </Table.Td>
              <Table.Td>
                <Code>{r.hash.slice(0, 10)}…</Code>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </ScrollTable>
      <Group justify="center">
        <Pagination
          total={Math.max(1, Math.ceil((q.data?.meta.total ?? 0) / 50))}
          value={page}
          onChange={setPage}
        />
      </Group>
    </Stack>
  );
}
