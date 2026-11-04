import { createTheme } from '@mantine/core';

// System font stack only: no external fonts/CDN (usable from mainland China, ADR 0002).
export const theme = createTheme({
  primaryColor: 'blue',
  defaultRadius: 'md',
  fontFamily:
    'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif',
  headings: { fontWeight: '650' },
});
