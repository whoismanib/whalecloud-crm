import {
  Badge,
  Group,
  Select,
  Table,
  Text,
  Title,
  type BadgeProps,
  type SelectProps,
  type TableProps,
} from '@mantine/core';
import type { ReactNode } from 'react';
import { Controller, type Control, type FieldValues, type Path } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { fmtMoney } from '../lib/format';

export function PageHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <Group justify="space-between" mb="md" wrap="wrap">
      <Title order={2}>{title}</Title>
      <Group gap="xs">{right}</Group>
    </Group>
  );
}

export function Money({
  value,
  currency = 'USD',
}: {
  value: string | number | null | undefined;
  currency?: string | null;
}) {
  return <Text span>{fmtMoney(value, currency ?? 'USD')}</Text>;
}

const STAGE_COLORS = [
  'gray',
  'cyan',
  'cyan',
  'blue',
  'indigo',
  'violet',
  'grape',
  'green',
  'teal',
  'lime',
  'yellow',
  'green',
];
export function StageBadge({ stage, status }: { stage: number; status?: string }) {
  const { t } = useTranslation();
  if (status && status !== 'OPEN') {
    return (
      <Badge color="red" variant="light">
        {t(`enums:oppStatus.${status}`)}
      </Badge>
    );
  }
  return (
    <Badge color={STAGE_COLORS[stage] ?? 'gray'} variant="light">
      {t(`enums:stage.${stage}`)}
    </Badge>
  );
}

const COLOR: Record<string, string> = {
  GREEN: 'green',
  AMBER: 'yellow',
  RED: 'red',
  NONE: 'gray',
  HEALTHY: 'green',
  AT_RISK: 'yellow',
  CRITICAL: 'red',
  STALE: 'gray',
  APPROVED: 'green',
  PENDING: 'yellow',
  REJECTED: 'red',
  INVALIDATED: 'gray',
  CANCELLED: 'gray',
  PAID: 'green',
  OVERDUE: 'red',
  DUE_SOON: 'yellow',
  ON_TRACK: 'blue',
  DONE: 'green',
  WHALE: 'blue',
  CLIENT: 'orange',
  HIGH: 'red',
  MEDIUM: 'yellow',
  LOW: 'green',
};

/** Badge with a translated enum value: `ns` = enums namespace key (e.g. "health"). */
export function EnumBadge({
  ns,
  value,
  ...rest
}: { ns: string; value: string | null | undefined } & BadgeProps) {
  const { t } = useTranslation();
  if (!value) return <Text c="dimmed">—</Text>;
  return (
    <Badge color={COLOR[value] ?? 'gray'} variant="light" {...rest}>
      {t(`enums:${ns}.${value}`, { defaultValue: value })}
    </Badge>
  );
}

/** Select bound to react-hook-form with translated enum options. */
export function EnumSelect<T extends FieldValues>({
  control,
  name,
  ns,
  values,
  label,
  ...rest
}: {
  control: Control<T>;
  name: Path<T>;
  ns: string;
  values: readonly string[];
  label: string;
} & Omit<SelectProps, 'data' | 'value' | 'onChange'>) {
  const { t } = useTranslation();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Select
          label={label}
          data={values.map((v) => ({
            value: v,
            label: t(`enums:${ns}.${v}`, { defaultValue: v }),
          }))}
          value={(field.value as string | null) ?? null}
          onChange={(v) => field.onChange(v)}
          error={
            fieldState.error
              ? t(`errors:validation.${fieldState.error.message}`, {
                  defaultValue: fieldState.error.message,
                })
              : undefined
          }
          {...rest}
        />
      )}
    />
  );
}

export function useFieldError() {
  const { t } = useTranslation();
  return (e?: { message?: string }) =>
    e?.message ? t(`errors:validation.${e.message}`, { defaultValue: e.message }) : undefined;
}

/**
 * Table that scrolls horizontally inside its own container on narrow screens (QA-005), so the
 * page itself never scrolls sideways. `minWidth` is the width below which the table scrolls.
 */
export function ScrollTable({ minWidth = 720, ...props }: TableProps & { minWidth?: number }) {
  return (
    <Table.ScrollContainer minWidth={minWidth} type="native">
      <Table {...props} />
    </Table.ScrollContainer>
  );
}
