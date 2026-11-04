import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Indicator,
  Popover,
  ScrollArea,
  Stack,
  Text,
  UnstyledButton,
} from '@mantine/core';
import { IconBell } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { fmtDate, fmtDateTime, fmtNumber } from '../lib/format';

/** Dates and decimal amounts in notification params are shown in the user's locale. */
function fmtParams(params: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(params).map(([k, v]) => [
      k,
      typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
        ? fmtDate(v)
        : typeof v === 'string' && /^-?\d+\.\d+$/.test(v)
          ? fmtNumber(v, 0)
          : v,
    ]),
  );
}

interface Notification {
  id: number;
  type: string;
  titleKey: string;
  params: Record<string, unknown>;
  link: string | null;
  createdAt: string;
  readAt: string | null;
}

/** In-app notifications (ADM-11): bell with unread count, polled every minute. */
export function NotificationBell() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => {
      const res = await fetch('/api/v1/notifications', { credentials: 'same-origin' });
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as { data: Notification[]; meta: { unread: number } };
    },
    refetchInterval: 60_000,
  });
  const unread = q.data?.meta.unread ?? 0;
  const open = async (n: Notification) => {
    if (!n.readAt) await api.post(`/notifications/${n.id}/read`);
    await qc.invalidateQueries({ queryKey: ['notifications'] });
    if (n.link) nav(n.link);
  };
  return (
    <Popover width={380} position="bottom-end" shadow="md">
      <Popover.Target>
        <Indicator label={unread} size={16} disabled={!unread} color="red" offset={4}>
          <ActionIcon
            variant="default"
            size="lg"
            aria-label={t('p2:notifications.title')}
            data-testid="bell"
          >
            <IconBell size={18} />
          </ActionIcon>
        </Indicator>
      </Popover.Target>
      <Popover.Dropdown>
        <Group justify="space-between" mb="xs">
          <Text fw={600}>{t('p2:notifications.title')}</Text>
          <Button
            size="compact-xs"
            variant="subtle"
            onClick={async () => {
              await api.post('/notifications/read-all');
              await qc.invalidateQueries({ queryKey: ['notifications'] });
            }}
          >
            {t('p2:notifications.readAll')}
          </Button>
        </Group>
        <ScrollArea.Autosize mah={420}>
          <Stack gap={4} data-testid="notifications-list">
            {(q.data?.data ?? []).length === 0 && (
              <Text c="dimmed" size="sm">
                {t('ui.empty')}
              </Text>
            )}
            {(q.data?.data ?? []).map((n) => (
              <UnstyledButton
                key={n.id}
                onClick={() => void open(n)}
                p={6}
                style={{ borderRadius: 6, opacity: n.readAt ? 0.6 : 1 }}
              >
                <Group justify="space-between" wrap="nowrap" align="flex-start">
                  <Text size="sm" fw={n.readAt ? 400 : 600}>
                    {t(`p2:notifications.titles.${n.titleKey}`, {
                      ...fmtParams(n.params),
                      defaultValue: n.titleKey,
                    })}
                  </Text>
                  {!n.readAt && <Badge size="xs" color="red" variant="dot" />}
                </Group>
                <Text size="xs" c="dimmed">
                  {fmtDateTime(n.createdAt)}
                </Text>
              </UnstyledButton>
            ))}
          </Stack>
        </ScrollArea.Autosize>
      </Popover.Dropdown>
    </Popover>
  );
}
