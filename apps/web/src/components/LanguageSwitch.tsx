import { Select } from '@mantine/core';
import { useTranslation } from 'react-i18next';
import { LANGS, setLanguage } from '../app/i18n';
import { api } from '../api/client';

export function LanguageSwitch({ persist = false }: { persist?: boolean }) {
  const { t, i18n } = useTranslation();
  return (
    <Select
      aria-label={t('ui.language')}
      data={LANGS}
      value={i18n.language}
      allowDeselect={false}
      w={170}
      size="xs"
      onChange={(v) => {
        if (!v) return;
        setLanguage(v);
        if (persist) void api.patch('/me/preferences', { locale: v }).catch(() => undefined);
      }}
    />
  );
}
