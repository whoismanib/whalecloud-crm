import i18n from '../app/i18n';

const loc = () =>
  i18n.language === 'zh-CN' ? 'zh-CN' : i18n.language === 'en' ? 'en-US' : 'es-CL';

export function fmtMoney(
  amount: string | number | null | undefined,
  currency = 'USD',
  digits?: number,
): string {
  if (amount === null || amount === undefined || amount === '') return '—';
  const n = Number(amount);
  return new Intl.NumberFormat(loc(), {
    style: 'currency',
    currency,
    maximumFractionDigits: digits ?? (currency === 'CLP' ? 0 : Math.abs(n) >= 1000 ? 0 : 2),
  }).format(n);
}

export function fmtNumber(v: string | number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || v === '') return '—';
  return new Intl.NumberFormat(loc(), { maximumFractionDigits: digits }).format(Number(v));
}

/** Fraction (0.58) → "58,0 %". */
export function fmtPct(v: string | number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || v === '') return '—';
  return new Intl.NumberFormat(loc(), {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(v));
}

export function fmtDate(v: string | null | undefined): string {
  if (!v) return '—';
  const d = v.length === 10 ? new Date(`${v}T12:00:00Z`) : new Date(v);
  return new Intl.DateTimeFormat(loc(), { year: 'numeric', month: 'short', day: '2-digit' }).format(
    d,
  );
}

export function fmtDateTime(v: string | null | undefined): string {
  if (!v) return '—';
  return new Intl.DateTimeFormat(loc(), { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(v),
  );
}

export function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago' }).format(new Date());
}
