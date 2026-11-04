import { Alert, List } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { ApiError, type ProblemError } from '../api/client';

/** Translates rule/gate failure codes + params into readable messages (es-CL by default). */
export function useRuleMessage() {
  const { t } = useTranslation();
  return (f: ProblemError) => {
    const params: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(f.params ?? {})) {
      if (Array.isArray(v)) {
        params[k] = v
          .map((x) =>
            k === 'types'
              ? t(`enums:evidence.${x}`)
              : k === 'conditions'
                ? t(`enums:condition.${x}`)
                : k === 'items'
                  ? t(`p2:complianceItem.${x}`, { defaultValue: String(x) })
                  : k === 'fields' || k === 'missing'
                    ? t(`pr.${x}`, {
                        defaultValue: t(`qual.${x}`, {
                          defaultValue: t(`p2:handoff.items.${x}`, { defaultValue: String(x) }),
                        }),
                      })
                    : String(x),
          )
          .join(', ');
      } else params[k] = v;
    }
    if (f.path !== undefined) {
      const msg = t(`errors:validation.${f.code}`, { defaultValue: f.message ?? f.code });
      return `${f.path}: ${msg}`;
    }
    return t(`errors:rules.${f.code}`, { ...params, defaultValue: f.code });
  };
}

export function RuleErrors({ error, failures }: { error?: unknown; failures?: ProblemError[] }) {
  const { t } = useTranslation();
  const msg = useRuleMessage();
  const list = failures ?? (error instanceof ApiError ? error.errors : []);
  if (!error && !list.length) return null;
  const title =
    error instanceof ApiError
      ? t(`errors:http.${error.code}`, { defaultValue: error.code })
      : error
        ? t('ui.error')
        : t('ui.fixFollowing');
  return (
    <Alert
      color={failures ? 'yellow' : 'red'}
      icon={<IconAlertTriangle size={18} />}
      title={title}
      data-testid="rule-errors"
    >
      {list.length > 0 && (
        <List size="sm" spacing={2}>
          {list.map((f, i) => (
            <List.Item key={i}>{msg(f)}</List.Item>
          ))}
        </List>
      )}
    </Alert>
  );
}
