import type { Rag } from './kpis';

export type ProcessKpiDirection = 'MIN' | 'MAX' | 'ZERO' | 'BAND' | 'NONE';

/**
 * DASH-05 traffic light for per-process KPIs (KPIS.md §4): MIN = higher is better (≥ target green,
 * ≥ 85 % amber); MAX = lower is better (≤ target green, ≤ 115 % amber); ZERO = target 0;
 * BAND = |value| ≤ target (forecast accuracy ±10 %); NONE = tracking only.
 */
export function processKpiRag(
  value: number | null,
  target: number | null,
  direction: ProcessKpiDirection,
): Rag {
  if (value === null || direction === 'NONE') return 'NONE';
  if (direction === 'ZERO') return value === 0 ? 'GREEN' : 'RED';
  if (target === null) return 'NONE';
  if (direction === 'BAND') return Math.abs(value) <= target ? 'GREEN' : 'RED';
  if (direction === 'MIN')
    return value >= target ? 'GREEN' : value >= target * 0.85 ? 'AMBER' : 'RED';
  return value <= target ? 'GREEN' : value <= target * 1.15 ? 'AMBER' : 'RED';
}

/** Share helper: null when there is nothing to measure. */
export function share(n: number, d: number): number | null {
  return d ? Math.round((n / d) * 10000) / 10000 : null;
}
