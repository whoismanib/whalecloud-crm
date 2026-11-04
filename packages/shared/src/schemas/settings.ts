import { z } from 'zod';
import { LINE_ITEM_TYPES, USER_ROLES } from '../enums';

const fraction = z.number().min(0).max(1);
const role = z.enum(USER_ROLES);

/** Configurable parameters (ADM-07). Keys mirror the `settings` table (DATA-MODEL §6). */
export const SettingsSchema = z.object({
  'qualification.meddpiccThresholdUsd': z.number().nonnegative(),
  'qualification.meddpiccMinScore': fraction,
  'businessCase.amountThresholdUsd': z.number().nonnegative(),
  'businessCase.marginThreshold': fraction,
  'approval.marginBasis': z.enum(['NET_INCOME', 'CONTRACT']),
  'approval.thresholds': z.object({ president: fraction, vp: fraction }),
  'margins.targets': z.record(z.enum(LINE_ITEM_TYPES), fraction),
  'approval.validDays': z.number().int().positive(),
  'approval.presidentCoApprovesVpBand': z.boolean(),
  'approval.nonEconomic': z.object({
    paymentTermDays: z.number().int().positive(),
    penaltyPct: fraction,
    approverRole: role,
    consult: z.object({
      PAYMENT_TERM_OVER_60: role,
      CLP_WITHOUT_FX_PREMIUM: role,
      PENALTY_OVER_10: role,
      UNLIMITED_LIABILITY: role,
    }),
  }),
  'sla.businessDays': z.object({
    P1_REGISTRATION: z.number().int().nonnegative(),
    P3_DECISION: z.number().int().nonnegative(),
    P3_INTERNAL_BEFORE_DEADLINE: z.number().int().nonnegative(),
    P5_PROJECT: z.number().int().nonnegative(),
    P5_CR: z.number().int().nonnegative(),
    P6_APPROVAL: z.number().int().nonnegative(),
    P7_LEGAL: z.number().int().nonnegative(),
    P7_REPOSITORY: z.number().int().nonnegative(),
    P8_ACCEPTANCE: z.number().int().nonnegative(),
    P8_INVOICE: z.number().int().nonnegative(),
    P9_HANDOFF: z.number().int().nonnegative(),
  }),
  'sla.pauseOnAwaitingChile': z.boolean(),
  'collections.offsets': z.object({
    D_MINUS_10: z.number().int(),
    D_PLUS_1: z.number().int(),
    D_PLUS_7: z.number().int(),
    D_PLUS_15: z.number().int(),
    D_PLUS_30: z.number().int(),
  }),
  'invoices.defaultPaymentTermDays': z.number().int().positive(),
  'forecast.stageProbabilities': z.record(z.string().regex(/^[1-6]$/), fraction),
  'forecast.commitMinStage': z.number().int().min(0).max(11),
  'review.staleDays': z.number().int().positive(),
  'health.staleBusinessDays': z.number().int().positive(),
  'kpi.rag': z.object({ amberPctOfPace: fraction }),
  'kpi.pendingAcceptanceBusinessDays': z.number().int().nonnegative(),
  'kpi.priceTimeWindowWeeks': z.number().int().positive(),
  'digital.verticals': z.array(z.string()),
  'compliance.requiredBeforeProposal': z.boolean(),
  'auth.sessionIdleHours': z.number().positive(),
  'auth.sessionAbsoluteDays': z.number().positive(),
});
export type Settings = z.infer<typeof SettingsSchema>;
export type SettingKey = keyof Settings;

export const DEFAULT_SETTINGS: Settings = {
  'qualification.meddpiccThresholdUsd': 500000,
  'qualification.meddpiccMinScore': 0.5,
  'businessCase.amountThresholdUsd': 2000000,
  'businessCase.marginThreshold': 0.6,
  'approval.marginBasis': 'NET_INCOME',
  'approval.thresholds': { president: 0.6, vp: 0.5 },
  'margins.targets': {
    OWN_SOFTWARE: 0.65,
    THIRD_PARTY_SOFTWARE: 0.65,
    IMPLEMENTATION: 0.63,
    SUPPORT_L3: 0.795,
    SUPPORT_L1L2: 0.68,
    HARDWARE: 0.65,
    WARRANTY: 0.68,
  },
  'approval.validDays': 60,
  'approval.presidentCoApprovesVpBand': false,
  'approval.nonEconomic': {
    paymentTermDays: 60,
    penaltyPct: 0.1,
    approverRole: 'LATAM_PRESIDENT',
    consult: {
      PAYMENT_TERM_OVER_60: 'CHINA_FINANCE',
      CLP_WITHOUT_FX_PREMIUM: 'CHINA_FINANCE',
      PENALTY_OVER_10: 'CHINA_LEGAL',
      UNLIMITED_LIABILITY: 'CHINA_LEGAL',
    },
  },
  'sla.businessDays': {
    P1_REGISTRATION: 2,
    P3_DECISION: 2,
    P3_INTERNAL_BEFORE_DEADLINE: 5,
    P5_PROJECT: 10,
    P5_CR: 5,
    P6_APPROVAL: 3,
    P7_LEGAL: 5,
    P7_REPOSITORY: 2,
    P8_ACCEPTANCE: 10,
    P8_INVOICE: 1,
    P9_HANDOFF: 5,
  },
  'sla.pauseOnAwaitingChile': true,
  'collections.offsets': {
    D_MINUS_10: -10,
    D_PLUS_1: 1,
    D_PLUS_7: 7,
    D_PLUS_15: 15,
    D_PLUS_30: 30,
  },
  'invoices.defaultPaymentTermDays': 45,
  'forecast.stageProbabilities': { '1': 0.1, '2': 0.2, '3': 0.3, '4': 0.4, '5': 0.5, '6': 0.7 },
  'forecast.commitMinStage': 4,
  'review.staleDays': 14,
  'health.staleBusinessDays': 10,
  'kpi.rag': { amberPctOfPace: 0.85 },
  'kpi.pendingAcceptanceBusinessDays': 10,
  'kpi.priceTimeWindowWeeks': 12,
  'digital.verticals': ['AI', 'FINTECH'],
  'compliance.requiredBeforeProposal': false,
  'auth.sessionIdleHours': 12,
  'auth.sessionAbsoluteDays': 7,
};

/** Merge stored settings over defaults, validating each key. Unknown keys are ignored. */
export function resolveSettings(stored: Partial<Record<string, unknown>>): Settings {
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const [k, v] of Object.entries(stored)) {
    if (k in DEFAULT_SETTINGS) merged[k] = v;
  }
  return SettingsSchema.parse(merged);
}
