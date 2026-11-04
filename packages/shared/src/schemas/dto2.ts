import { z } from 'zod';
import {
  ACCOUNT_REVIEW_KINDS,
  COMPLIANCE_ANSWERS,
  CURRENCIES,
  DISTRIBUTOR_STATUSES,
  FORECAST_CATEGORIES,
  LOCALES,
  ONBOARDING_ITEMS,
  PROCESS_CODES,
  RACI_LETTERS,
  RESOURCE_TYPES,
  RFP_DECISIONS,
  RFP_RESULTS,
  RFP_TYPES,
  USER_ROLES,
  VERTICALS,
  YES_NO_NA,
} from '../enums';
import {
  zDate,
  zDecimal,
  zFraction,
  zHttpsUrl,
  zMoney,
  zReqText,
  zStandardName,
  zText,
  zUuid,
} from './dto';

// ---------- P9 ----------
export const HandoffUpdateSchema = z.object({
  plannedStart: zDate.optional().nullable(),
  actualStart: zDate.optional().nullable(),
  commercialSheetReviewed: z.boolean().optional(),
  sowReviewed: z.boolean().optional(),
  milestonesReviewed: z.boolean().optional(),
  acceptanceCriteriaReviewed: z.boolean().optional(),
  zmpProjectId: zText(100).optional(),
  notes: zText(4000).optional().nullable(),
});

// ---------- P10 ----------
export const AccountPlanSchema = z.object({
  year: z.number().int().min(2020).max(2100),
  objectives: zText(4000).optional().nullable(),
  growthOpportunities: zText(4000).optional().nullable(),
  risks: zText(4000).optional().nullable(),
  contactMap: z
    .array(z.object({ contactId: zUuid, influence: zText(40), relationship: zText(40) }))
    .default([]),
  target: zMoney.optional().nullable(),
  targetCurrency: z.enum(CURRENCIES).optional().nullable(),
});
export type AccountPlanInput = z.input<typeof AccountPlanSchema>;

export const AccountReviewSchema = z.object({
  kind: z.enum(ACCOUNT_REVIEW_KINDS),
  periodStart: zDate,
  heldOn: zDate,
  findings: zReqText(4000),
  actions: zText(4000).optional().nullable(),
});
export type AccountReviewInput = z.input<typeof AccountReviewSchema>;

// ---------- P11 ----------
export const RateCardSchema = z.object({
  accountId: zUuid.optional().nullable(),
  contractId: zUuid.optional().nullable(),
  profile: zReqText(100),
  rate: zMoney,
  currency: z.enum(CURRENCIES),
  unit: zText(20).default('HOUR'),
  validFrom: zDate,
  validTo: zDate.optional().nullable(),
});
export type RateCardInput = z.input<typeof RateCardSchema>;

export const ChangeRequestCreateSchema = z.object({
  parentContractId: zUuid,
  title: zReqText(300),
  description: zText(4000).optional().nullable(),
});
export const CrLinesSchema = z
  .array(
    z.object({
      profile: zReqText(100),
      hours: zDecimal.refine((v) => Number(v) > 0, 'AMOUNT_POSITIVE'),
    }),
  )
  .min(1);
export const CrPoSchema = z.object({
  poNumber: zReqText(60),
  poReceivedOn: zDate,
  url: zHttpsUrl,
  standardName: zStandardName,
});
export const CrExceptionSchema = z.object({ reason: zReqText(2000), expiresOn: zDate });
export const CrReceptionSchema = z.object({
  receptionOn: zDate,
  url: zHttpsUrl,
  standardName: zStandardName,
});

// ---------- P12 ----------
export const ForecastUpdateSchema = z.object({
  forecastCategory: z.enum(FORECAST_CATEGORIES).nullable(),
});

// ---------- P13 ----------
export const DistributorSchema = z.object({
  name: zReqText(200),
  taxId: zText(40).optional().nullable(),
  countryCode: z.string().length(2),
  contactName: zText(200).optional().nullable(),
  contactEmail: z.string().email().optional().nullable().or(z.literal('')),
  status: z.enum(DISTRIBUTOR_STATUSES).default('PROSPECT'),
});
export type DistributorInput = z.input<typeof DistributorSchema>;
export const AgreementSchema = z.object({
  territories: z.array(z.string().length(2)).default([]),
  verticals: z.array(z.enum(VERTICALS)).default([]),
  products: zText(1000).optional().nullable(),
  marginPct: zFraction,
  startsOn: zDate,
  endsOn: zDate,
  status: z.enum(['DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED']).default('ACTIVE'),
});
export type AgreementInput = z.input<typeof AgreementSchema>;
export const DealRegistrationSchema = z.object({
  distributorId: zUuid,
  accountId: zUuid,
  opportunityId: zUuid.optional().nullable(),
  registeredOn: zDate,
  notes: zText(2000).optional().nullable(),
});
export const RegistrationDecisionSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
  reason: zReqText(2000),
});
export const TrainingSchema = z.object({
  kind: z.enum(['TRAINING', 'DEMO']),
  heldOn: zDate,
  product: zText(200).optional().nullable(),
  attendees: zText(1000).optional().nullable(),
  notes: zText(2000).optional().nullable(),
});

// ---------- P14 ----------
export const ComplianceItemsSchema = z.array(
  z.object({
    itemCode: zReqText(60),
    answer: z.enum(YES_NO_NA).nullable(),
    notes: zText(2000).optional().nullable(),
  }),
);
export const ComplianceReviewSchema = z.object({
  status: z.enum(['REVIEWED', 'REJECTED']),
  comment: zText(2000).optional().nullable(),
});

// ---------- P15 ----------
export const OnboardingKitSchema = z.object({
  items: z.array(z.enum(ONBOARDING_ITEMS)).min(1),
  productiveDays: z.number().int().positive().default(30),
  notes: zText(2000).optional().nullable(),
});
export const OnboardingCreateSchema = z.object({
  userId: zUuid,
  countryCode: z.string().length(2),
  startDate: zDate,
});
export const OnboardingItemSchema = z.object({
  done: z.boolean(),
  notes: zText(1000).optional().nullable(),
});

// ---------- P16 ----------
export const ResidentPoSchema = z.object({
  contractId: zUuid,
  poNumber: zReqText(60),
  totalHours: zDecimal.refine((v) => Number(v) > 0, 'AMOUNT_POSITIVE'),
  validFrom: zDate.optional().nullable(),
  validTo: zDate.optional().nullable(),
});
export const HoursImportSchema = z.object({
  month: zDate.refine((d) => d.endsWith('-01'), 'MONTH_FIRST_DAY'),
  csv: z.string().min(1).max(2_000_000),
});

// ---------- admin ----------
export const UserCreateSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  fullName: zReqText(200),
  password: z.string().min(12, 'PASSWORD_TOO_SHORT').max(200),
  roles: z.array(z.enum(USER_ROLES)).min(1),
  locale: z.enum(LOCALES).default('es-CL'),
  timezone: zText(64).default('America/Santiago'),
  calendarId: z.enum(['CL', 'CN']).default('CL'),
  countryCodes: z.array(z.string().min(1).max(2)).min(1).default(['CL']),
});
export const UserUpdateSchema = z.object({
  fullName: zReqText(200).optional(),
  roles: z.array(z.enum(USER_ROLES)).min(1).optional(),
  locale: z.enum(LOCALES).optional(),
  timezone: zText(64).optional(),
  calendarId: z.enum(['CL', 'CN']).optional(),
  countryCodes: z.array(z.string().min(1).max(2)).min(1).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(12, 'PASSWORD_TOO_SHORT').max(200).optional(),
});
export const RaciUpdateSchema = z.object({
  comment: zReqText(500),
  entries: z.array(
    z.object({
      process: z.enum(PROCESS_CODES),
      role: z.enum(USER_ROLES),
      letters: z.array(z.enum(RACI_LETTERS)),
    }),
  ),
});
export const SettingUpdateSchema = z.object({ value: z.unknown(), reason: zReqText(500) });
export const HolidaySchema = z.object({
  date: zDate,
  name: zReqText(100),
  isWorkday: z.boolean().default(false),
});

// ---------- import ----------
export const CsvImportSchema = z.object({
  csv: z.string().min(1).max(5_000_000),
  dryRun: z.boolean().default(false),
});
export const LegacyImportSchema = z.object({
  data: z.object({
    wom: z.array(z.record(z.unknown())).optional(),
    new_clients: z.array(z.record(z.unknown())).optional(),
    billing: z.array(z.record(z.unknown())).optional(),
  }),
  dryRun: z.boolean().default(false),
});

// ---------- P3 Preventa (QA-004) ----------
export const RfpCreateSchema = z.object({
  type: z.enum(RFP_TYPES).default('RFP'),
  title: zReqText(300),
  receivedOn: zDate,
  clientDeadline: zDate,
  documentsUrl: zHttpsUrl.optional().nullable(),
  notes: zText(4000).optional().nullable(),
});
export type RfpCreate = z.input<typeof RfpCreateSchema>;
export const RfpDecisionSchema = z.object({
  decision: z.enum(RFP_DECISIONS).exclude(['PENDING']),
  reason: zText(2000).optional().nullable(),
});
export const RfpRequirementsSchema = z
  .array(
    z.object({
      ref: zText(40).optional().nullable(),
      requirement: zReqText(2000),
      assigneeUserId: zUuid.optional().nullable(),
    }),
  )
  .min(1);
export const RfpRequirementUpdateSchema = z.object({
  answer: z.enum(COMPLIANCE_ANSWERS).optional(),
  comment: zText(2000).optional().nullable(),
  assigneeUserId: zUuid.optional().nullable(),
});
export const RfpDeliverSchema = z.object({ deliveredOn: zDate.optional() });
export const RfpResultSchema = z.object({
  result: z.enum(RFP_RESULTS).exclude(['PENDING']),
  winningCompetitor: zText(200).optional().nullable(),
  winningPrice: zMoney.optional().nullable(),
  winningCurrency: z.enum(CURRENCIES).optional().nullable(),
});

// ---------- P5-04 cost estimates and ADM-04 delegations (QA-008) ----------
export const CostEstimateAssignSchema = z
  .array(
    z.object({
      area: zReqText(100),
      resourceType: z.enum(RESOURCE_TYPES),
      assigneeUserId: zUuid,
      mandatory: z.boolean().default(true),
      notes: zText(2000).optional().nullable(),
    }),
  )
  .min(1);
export const CostEstimateUpdateSchema = z.object({
  personMonths: zDecimal.refine((v) => Number(v) >= 0, 'AMOUNT_NEGATIVE').optional(),
  notes: zText(2000).optional().nullable(),
});
export const DelegationCreateSchema = z.object({
  delegatorUserId: zUuid.optional(),
  delegateUserId: zUuid,
  role: z.enum(USER_ROLES),
  startsOn: zDate,
  endsOn: zDate,
  reason: zReqText(500),
});

// ---------- Mail sync, phase 0: legacy crm_cache.json (ADR 0008) ----------
const zCount = z.coerce.number().int().min(0).catch(0);
const zIsoOrNull = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), 'INVALID_DATE')
  .nullable()
  .catch(null);
export const LegacyMailProjectSchema = z.object({
  client: z.string().default(''),
  section: z.string().max(300).default(''),
  project: z.string().min(1).max(300),
  inbox: zCount,
  sent: zCount,
  meetings: zCount,
  upcoming: zCount,
  last_date: zIsoOrNull,
  next_meeting: zIsoOrNull,
  recent_subjects: z.array(z.string().max(1000)).max(20).catch([]),
  hold: z.string().catch(''),
  closed: z.string().catch(''),
  edo: z.array(z.coerce.string()).max(50).catch([]),
  status: z.string().catch(''),
  seen_date: zIsoOrNull,
  last_days: z.coerce.number().int().min(0).catch(999),
});
export const LegacyMailCacheSchema = z.object({
  /** Local time of the mailbox owner's Mac, "YYYY-MM-DD HH:MM:SS" (or ISO with offset). */
  generated_at: z.string().regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?/, 'INVALID_DATE'),
  window_days: z.coerce.number().int().min(1).max(365).default(30),
  inbox_count: zCount,
  sent_count: zCount,
  calendar_count: zCount,
  matched: zCount,
  meetings_matched: zCount,
  upcoming_matched: zCount,
  unmatched_count: zCount,
  unmatched_events: zCount,
  clients: z.record(
    z.object({
      sections: z.record(z.object({ projects: z.array(LegacyMailProjectSchema).max(500) })),
    }),
  ),
});
export const LegacyMailImportSchema = z.object({
  data: LegacyMailCacheSchema,
  dryRun: z.boolean().default(false),
  /** Admins may import a cache on behalf of another user (recorded in the audit log). */
  userId: zUuid.optional(),
  /** Legacy client label → CRM account name, for clients the name matcher cannot resolve. */
  aliases: z.record(z.string().max(200)).optional(),
});
export const EngagementQuerySchema = z.object({
  scope: z.enum(['mine', 'all']).default('mine'),
});
