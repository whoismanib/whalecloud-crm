import { Button, Group } from '@mantine/core';
import { IconDownload } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';

/** CSV / XLSX download of a list (server-side export, audited as EXPORT). */
export function ExportButtons({ entity, query = '' }: { entity: string; query?: string }) {
  const { t } = useTranslation();
  const href = (f: string) => `/api/v1/exports/${entity}?format=${f}${query ? `&${query}` : ''}`;
  return (
    <Group gap={4}>
      {(['csv', 'xlsx'] as const).map((f) => (
        <Button
          key={f}
          component="a"
          href={href(f)}
          size="xs"
          variant="default"
          leftSection={<IconDownload size={14} />}
          data-testid={`export-${entity}-${f}`}
        >
          {t(`p2:export.${f}`)}
        </Button>
      ))}
    </Group>
  );
}
