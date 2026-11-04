/** Calendar date (YYYY-MM-DD) of an instant in a timezone. */
export function dateInTz(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function toIsoDate(v: Date | string | null | undefined, timeZone = 'UTC'): string | null {
  if (!v) return null;
  if (typeof v === 'string') return v.length === 10 ? v : dateInTz(new Date(v), timeZone);
  return dateInTz(v, timeZone);
}
