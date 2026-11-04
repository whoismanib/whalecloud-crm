import { Badge, Code, Table, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../../api/client';
import { fmtDateTime } from '../../../lib/format';
import type { TabProps } from '../types';

export interface AuditRow {
  id: number;
  occurredAt: string;
  action: string;
  category: string;
  entityType: string;
  changes: { field: string; old: unknown; new: unknown }[];
  reason: string | null;
  actorName: string | null;
}

export function ChangesCell({ changes }: { changes: AuditRow['changes'] }) {
  return (
    <>
      {changes.slice(0, 6).map((c, i) => (
        <Text key={i} size="xs">
          <Code>{c.field}</Code> {JSON.stringify(c.old)} → {JSON.stringify(c.new)}
        </Text>
      ))}
    </>
  );
}

export function TimelineTab({ opp }: TabProps) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ['timeline', opp.id],
    queryFn: () => api.get<AuditRow[]>(`/opportunities/${opp.id}/timeline`),
  });
  return (
    <Table striped data-testid="timeline">
      <Table.Thead>
        <Table.Tr>
          <Table.Th>{t('audit.occurredAt')}</Table.Th>
          <Table.Th>{t('audit.actor')}</Table.Th>
          <Table.Th>{t('audit.category')}</Table.Th>
          <Table.Th>{t('audit.action')}</Table.Th>
          <Table.Th>{t('audit.changes')}</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {(q.data ?? []).map((r) => (
          <Table.Tr key={r.id}>
            <Table.Td>{fmtDateTime(r.occurredAt)}</Table.Td>
            <Table.Td>{r.actorName ?? 'sistema'}</Table.Td>
            <Table.Td>
              <Badge variant="light">{t(`enums:auditCategory.${r.category}`)}</Badge>
            </Table.Td>
            <Table.Td>
              {t(`enums:auditAction.${r.action}`)} · {r.entityType}
            </Table.Td>
            <Table.Td>
              <ChangesCell changes={r.changes} />
              {r.reason && (
                <Text size="xs" c="dimmed">
                  {r.reason}
                </Text>
              )}
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
