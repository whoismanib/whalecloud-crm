import { notifications } from '@mantine/notifications';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

/** Mutation that invalidates queries on success and shows a toast; errors are rendered by RuleErrors. */
export function useAction<V, R = unknown>(
  fn: (v: V) => Promise<R>,
  opts: { invalidate?: string[][]; onDone?: (r: R) => void } = {},
) {
  const qc = useQueryClient();
  const { t } = useTranslation();
  return useMutation<R, unknown, V>({
    mutationFn: fn,
    onSuccess: async (r) => {
      await Promise.all(
        (opts.invalidate ?? [[]]).map((k) => qc.invalidateQueries({ queryKey: k })),
      );
      notifications.show({ color: 'green', message: t('ui.saved') });
      opts.onDone?.(r);
    },
  });
}
