import { D, type Numeric } from './common';
import type { QualStatus } from '../enums';
import type { Settings } from '../schemas/settings';

export const BANT_KEYS = ['bantBudget', 'bantAuthority', 'bantNeed', 'bantTimeline'] as const;
export const MEDDPICC_KEYS = [
  'mMetrics',
  'mEconomicBuyer',
  'mDecisionCriteria',
  'mDecisionProcess',
  'mPaperProcess',
  'mIdentifyPain',
  'mChampion',
  'mCompetition',
] as const;

export type Qualification = Record<(typeof BANT_KEYS)[number], QualStatus> &
  Record<(typeof MEDDPICC_KEYS)[number], QualStatus>;

export const EMPTY_QUALIFICATION: Qualification = {
  bantBudget: 'EMPTY',
  bantAuthority: 'EMPTY',
  bantNeed: 'EMPTY',
  bantTimeline: 'EMPTY',
  mMetrics: 'EMPTY',
  mEconomicBuyer: 'EMPTY',
  mDecisionCriteria: 'EMPTY',
  mDecisionProcess: 'EMPTY',
  mPaperProcess: 'EMPTY',
  mIdentifyPain: 'EMPTY',
  mChampion: 'EMPTY',
  mCompetition: 'EMPTY',
};

/** BANT is complete when the four elements are COMPLETE (P2-01). */
export function bantComplete(q: Qualification): boolean {
  return BANT_KEYS.every((k) => q[k] === 'COMPLETE');
}

export function bantMissing(q: Qualification): string[] {
  return BANT_KEYS.filter((k) => q[k] !== 'COMPLETE');
}

/** MEDDPICC score 0..1: EMPTY 0, PARTIAL 0.5, COMPLETE 1; average of the 8 elements (P2-02). */
export function meddpiccScore(q: Qualification): number {
  const v = (s: QualStatus) => (s === 'COMPLETE' ? 1 : s === 'PARTIAL' ? 0.5 : 0);
  const sum = MEDDPICC_KEYS.reduce((acc, k) => acc + v(q[k]), 0);
  return Math.round((sum / MEDDPICC_KEYS.length) * 1000) / 1000;
}

/** MEDDPICC is mandatory when the amount is strictly above USD 500,000 (P2-02: ≤ 500k optional). */
export function meddpiccRequired(
  amountUsd: Numeric | null,
  settings: Pick<Settings, 'qualification.meddpiccThresholdUsd'>,
): boolean {
  if (amountUsd === null) return false;
  return D(amountUsd).gt(settings['qualification.meddpiccThresholdUsd']);
}
