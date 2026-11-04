import { z } from 'zod';
import {
  ACTIVITY_TYPES,
  BALL_IN,
  BILLING_ENGINES,
  CAPEX_OPEX,
  COMPETITION_TYPES,
  CONTACT_ROLES,
  CONTRACT_STATUSES,
  CONTRACT_TYPES,
  CURRENCIES,
  CUSTOMER_TYPES,
  DOC_STATUSES,
  EVIDENCE_TYPES,
  FORECAST_CATEGORIES,
  FX_KINDS,
  LEAD_ORIGINS,
  LINE_ITEM_TYPES,
  MILESTONE_TRIGGERS,
  PRICE_REQUEST_STATUSES,
  PRICE_REQUEST_TYPES,
  QUAL_STATUSES,
  RELATIONSHIP_TYPES,
  RISK_LEVELS,
  SIGNATURE_TYPES,
  SIGNING_MODELS,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  USER_ROLES,
  VERTICALS,
  AUDIT_CATEGORIES,
  LOCALES,
} from '../enums';
import { REPOSITORY_NAME_REGEX } from '../rules/naming';

// ---------- primitives ----------

/** Decimal amount sent as string (or number) → normalised string. */
export const zDecimal = z
  .union([z.string(), z.number()])
  .transform((v) => String(v).trim().replace(',', '.'))
  .refine((v) => /^-?\d+(\.\d+)?$/.test(v), { message: 'DECIMAL_INVALID' });
export const zMoney = zDecimal.refine((v) => Number(v) >= 0, { message: 'AMOUNT_NEGATIVE' });
export const zFraction = zDecimal.refine((v) => Number(v) >= -10 && Number(v) <= 1, {
  message: 'FRACTION_INVALID',
});
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'DATE_INVALID');
export const zUuid = z.string().uuid();
export const zText = (max = 2000) => z.string().trim().max(max);
export const zReqText = (max = 2000) => z.string().trim().min(1, 'REQUIRED').max(max);
export const zStandardName = z.string().regex(REPOSITORY_NAME_REGEX, 'NAMING_INVALID');
export const zHttpsUrl = z.string().regex(/^https:\/\/\S+$/, 'URL_HTTPS_REQUIRED');

export const zPagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

// ---------- auth ----------

export const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});
export const MfaVerifySchema = z.object({ code: z.string().regex(/^\d{6}$/) });
export const PreferencesSchema = z.object({
  locale: z.enum(LOCALES).optional(),
  timezone: z.string().max(64).optional(),
});

// ---------- accounts / contacts ----------

export const AccountCreateSchema = z.object({
  name: zReqText(200),
  legalName: zText(200).optional().nullable(),
  // '' (blank form field) must be stored as NULL: the unique (country, tax_id) index ignores NULLs.
  taxId: zText(40)
    .optional()
    .nullable()
    .transform((v) => (v === '' ? null : v)),
  countryCode: z.string().length(2),
  vertical: z.enum(VERTICALS),
  customerType: z.enum(CUSTOMER_TYPES),
  defaultBillingEntityId: zUuid,
  currency: z.enum(CURRENCIES),
  isKeyAccount: z.boolean().default(false),
  acceptsSimpleEsign: z.boolean().default(false),
  ownerId: zUuid.optional(),
  website: zText(200).optional().nullable(),
  notes: zText().optional().nullable(),
});
export type AccountCreate = z.input<typeof AccountCreateSchema>;
export const AccountUpdateSchema = AccountCreateSchema.partial().extend({
  rowVersion: z.number().int(),
});

export const ContactCreateSchema = z.object({
  firstName: zReqText(100),
  lastName: zReqText(100),
  jobTitle: zText(150).optional().nullable(),
  email: z.string().trim().email().optional().nullable().or(z.literal('')),
  phone: zText(40).optional().nullable(),
  buyingRoles: z.array(z.enum(CONTACT_ROLES)).default([]),
  preferredLanguage: zText(10).optional().nullable(),
});
export type ContactCreate = z.input<typeof ContactCreateSchema>;
export const ContactUpdateSchema = ContactCreateSchema.partial();

export const ActivityCreateSchema = z.object({
  accountId: zUuid,
  opportunityId: zUuid.optional().nullable(),
  type: z.enum(ACTIVITY_TYPES),
  occurredAt: z.string().datetime({ offset: true }).or(zDate),
  subject: zReqText(300),
  notes: zText(4000).optional().nullable(),
  outcome: zText(500).optional().nullable(),
});

// ---------- opportunities ----------

export const OpportunityCreateSchema = z.object({
  name: zReqText(200),
  accountId: zUuid,
  contactId: zUuid,
  countryCode: z.string().length(2),
  vertical: z.enum(VERTICALS),
  billingEngine: z.enum(BILLING_ENGINES, { errorMap: () => ({ message: 'ENGINE_REQUIRED' }) }),
  origin: z.enum(LEAD_ORIGINS),
  distributorId: zUuid.optional().nullable(),
  amount: zMoney,
  currency: z.enum(CURRENCIES),
  expectedCloseDate: zDate,
  firstContactDate: zDate,
  forecastCategory: z.enum(FORECAST_CATEGORIES).optional().nullable(),
  risk: z.enum(RISK_LEVELS).optional().nullable(),
  ownerId: zUuid.optional(),
});
export type OpportunityCreate = z.input<typeof OpportunityCreateSchema>;

export const OpportunityUpdateSchema = z.object({
  rowVersion: z.number().int(),
  name: zReqText(200).optional(),
  amount: zMoney.optional(),
  currency: z.enum(CURRENCIES).optional(),
  billingEngine: z.enum(BILLING_ENGINES).optional(),
  expectedCloseDate: zDate.optional(),
  decisionDate: zDate.optional().nullable(),
  pain: zText(4000).optional().nullable(),
  sponsorContactId: zUuid.optional().nullable(),
  decisionCriteria: zText(4000).optional().nullable(),
  competitors: z.array(zReqText(100)).optional(),
  forecastCategory: z.enum(FORECAST_CATEGORIES).optional().nullable(),
  risk: z.enum(RISK_LEVELS).optional().nullable(),
  zmpProjectId: zText(100).optional().nullable(),
  chinaSystemContractId: zText(100).optional().nullable(),
  reason: zText(500).optional().nullable(),
});

export const TransitionSchema = z.object({
  toStage: z.number().int().min(0).max(11),
  reason: zText(500).optional().nullable(),
});

export const CloseSchema = z.object({
  status: z.enum(['LOST', 'DISCARDED', 'NOT_QUOTED']),
  reason: zText(1000).optional().nullable(),
  winningCompetitor: zText(200).optional().nullable(),
  winningPrice: zMoney.optional().nullable(),
  winningPriceCurrency: z.enum(CURRENCIES).optional().nullable(),
});

const qual = z.enum(QUAL_STATUSES);
export const QualificationSchema = z.object({
  bantBudget: qual,
  bantAuthority: qual,
  bantNeed: qual,
  bantTimeline: qual,
  mMetrics: qual,
  mEconomicBuyer: qual,
  mDecisionCriteria: qual,
  mDecisionProcess: qual,
  mPaperProcess: qual,
  mIdentifyPain: qual,
  mChampion: qual,
  mCompetition: qual,
  notes: z.record(z.string(), zText(2000)).default({}),
});
export type QualificationInput = z.input<typeof QualificationSchema>;

export const OpportunityContactsSchema = z.array(
  z.object({ contactId: zUuid, roles: z.array(z.enum(CONTACT_ROLES)) }),
);

// ---------- P5 price requests ----------

export const ExpectedMilestoneSchema = z.object({
  seq: z.number().int().min(1),
  pct: zDecimal.refine((v) => Number(v) > 0 && Number(v) <= 100, 'PCT_INVALID'),
  trigger: z.enum(MILESTONE_TRIGGERS),
  triggerText: zText(300).optional().nullable(),
});

export const PriceRequestUpdateSchema = z.object({
  relationshipType: z.enum(RELATIONSHIP_TYPES).nullable().optional(),
  competitionType: z.enum(COMPETITION_TYPES).nullable().optional(),
  salesOwnerId: zUuid.nullable().optional(),
  solutionOwnerName: zText(200).nullable().optional(),
  deliveryOwnerName: zText(200).nullable().optional(),
  projectStageLabel: zText(100).nullable().optional(),
  projectLevel: zText(50).nullable().optional(),
  budget: zMoney.nullable().optional(),
  budgetCurrency: z.enum(CURRENCIES).nullable().optional(),
  signingModel: z.enum(SIGNING_MODELS).nullable().optional(),
  currency: z.enum(CURRENCIES).nullable().optional(),
  warrantyMonths: z.number().int().min(0).max(120).nullable().optional(),
  summary: zText(4000).nullable().optional(),
  strategy: zText(4000).nullable().optional(),
  mainCompetitor: zText(200).nullable().optional(),
  risks: zText(4000).nullable().optional(),
  scopeSummary: zText(8000).nullable().optional(),
  assumptions: zText(8000).nullable().optional(),
  exclusions: zText(8000).nullable().optional(),
  billingEngine: z.enum(BILLING_ENGINES).nullable().optional(),
  targetPrice: zMoney.nullable().optional(),
  targetPriceCurrency: z.enum(CURRENCIES).nullable().optional(),
  targetCompetitor: zText(200).nullable().optional(),
});
export type PriceRequestUpdate = z.input<typeof PriceRequestUpdateSchema>;

export const ExpectedMilestonesSchema = z.array(ExpectedMilestoneSchema).min(1);

export const PriceRequestCreateSchema = z.object({
  type: z.enum(PRICE_REQUEST_TYPES).default('PROJECT'),
});

export const PriceRequestStatusSchema = z.object({
  status: z
    .enum(PRICE_REQUEST_STATUSES)
    .refine((s) => ['COSTING', 'BUILDING', 'READY_FOR_APPROVAL'].includes(s)),
  holderRole: z.enum(USER_ROLES).optional().nullable(),
});

export const LineItemSchema = z.object({
  lineNo: z.number().int().min(1),
  block: zText(100).optional().nullable(),
  itemType: z.enum(LINE_ITEM_TYPES),
  capexOpex: z.enum(CAPEX_OPEX),
  description: zText(500).optional().nullable(),
  quantity: zDecimal.optional(),
  cost: zMoney,
  targetMargin: zFraction.optional().nullable(),
  priceExTax: zMoney,
  netIncome: zMoney,
  commercialCosts: zMoney.default('0'),
  supportYears: z.number().int().min(0).max(20).optional().nullable(),
});
export type LineItemDto = z.input<typeof LineItemSchema>;

export const SheetMilestoneSchema = z.object({
  seq: z.number().int().min(1),
  pct: zDecimal.refine((v) => Number(v) > 0 && Number(v) <= 100, 'PCT_INVALID'),
  trigger: z.enum(MILESTONE_TRIGGERS),
  triggerText: zText(300).optional().nullable(),
  expectedQuarter: zText(10).optional().nullable(),
});

export const SheetVersionCreateSchema = z.object({
  versionLabel: zReqText(20),
  currency: z.enum(CURRENCIES),
  fileStandardName: zStandardName.optional().nullable(),
  fileUrl: zHttpsUrl.optional().nullable(),
  lineItems: z.array(LineItemSchema).min(1),
  cashflowMilestones: z.array(SheetMilestoneSchema).default([]),
  tcMilestones: z.array(SheetMilestoneSchema).default([]),
  tcTerms: z
    .object({
      offerValidityDays: z.number().int().min(1).max(365).default(30),
      paymentTermDays: z.number().int().min(0).max(365).nullable().optional(),
      clpWithoutFxPremium: z.boolean().default(false),
      penaltyCapPct: zFraction.nullable().optional(),
      unlimitedLiability: z.boolean().default(false),
      entities: zText(500).nullable().optional(),
    })
    .default({}),
  notes: zText(4000).optional().nullable(),
});
export type SheetVersionCreate = z.input<typeof SheetVersionCreateSchema>;

// ---------- P4 / P6 ----------

export const BusinessCaseSchema = z.object({
  pain: zText(4000).optional().nullable(),
  baselineMetric: zText(2000).optional().nullable(),
  benefit: zText(4000).optional().nullable(),
  tcoHorizonYears: z.number().int().min(1).max(10).optional().nullable(),
  tco: zMoney.optional().nullable(),
  tcoCurrency: z.enum(CURRENCIES).optional().nullable(),
  roiPct: zDecimal.optional().nullable(),
  paybackMonths: zDecimal.optional().nullable(),
  risks: zText(4000).optional().nullable(),
  strategicValue: zText(2000).optional().nullable(),
});
export type BusinessCaseInput = z.input<typeof BusinessCaseSchema>;

export const DecisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED', 'CHANGES_REQUESTED']),
  comment: zText(2000).optional().nullable(),
});

export const ApprovalRequestCreateSchema = z.object({
  competitiveJustification: zText(4000).optional().nullable(),
  businessCaseId: zUuid.optional().nullable(),
});

// ---------- P7 contracts ----------

export const ContractCreateSchema = z.object({
  accountId: zUuid,
  opportunityId: zUuid.optional().nullable(),
  parentContractId: zUuid.optional().nullable(),
  type: z.enum(CONTRACT_TYPES),
  number: zText(60).optional().nullable(),
  title: zReqText(300),
  signingModel: z.enum(SIGNING_MODELS).optional().nullable(),
  billingEntityId: zUuid,
  billingEngine: z.enum(BILLING_ENGINES).optional().nullable(),
  amount: zMoney.optional().nullable(),
  currency: z.enum(CURRENCIES).optional().nullable(),
  startDate: zDate.optional().nullable(),
  endDate: zDate.optional().nullable(),
  renewable: z.boolean().default(false),
});
export type ContractCreate = z.input<typeof ContractCreateSchema>;

export const ContractSignSchema = z.object({
  signedOn: zDate,
  repositoryUrl: zHttpsUrl,
  standardName: zStandardName,
  chinaSystemId: zReqText(100),
});

export const ContractUpdateSchema = z.object({
  status: z.enum(CONTRACT_STATUSES).optional(),
  repositoryUrl: zHttpsUrl.optional().nullable(),
  endDate: zDate.optional().nullable(),
});

export const HandoffSchema = z.object({
  meetingAt: z.string().datetime({ offset: true }).or(zDate),
  attendeeUserIds: z.array(zUuid).min(1),
  externalAttendees: zText(500).optional().nullable(),
  acceptanceCriteria: zText(4000).optional().nullable(),
  zmpProjectId: zReqText(100),
  plannedStart: zDate.optional().nullable(),
  actualStart: zDate.optional().nullable(),
  commercialSheetReviewed: z.boolean().default(false),
  sowReviewed: z.boolean().default(false),
  milestonesReviewed: z.boolean().default(false),
  acceptanceCriteriaReviewed: z.boolean().default(false),
  sowUrl: zHttpsUrl.optional().nullable(),
  notes: zText(4000).optional().nullable(),
});

// ---------- P8 ----------

export const MilestoneCreateSchema = z.object({
  seq: z.number().int().min(1),
  name: zReqText(200),
  pct: zDecimal.optional().nullable(),
  amount: zMoney,
  currency: z.enum(CURRENCIES),
  trigger: z.enum(MILESTONE_TRIGGERS).optional().nullable(),
  plannedDate: zDate.optional().nullable(),
  acceptanceCriteria: zText(4000).optional().nullable(),
});

export const EvidenceCreateSchema = z.object({
  evidenceType: z.enum(EVIDENCE_TYPES),
  url: zHttpsUrl,
  standardName: zStandardName,
  receivedOn: zDate,
  signatureType: z.enum(SIGNATURE_TYPES).optional().nullable(),
  notes: zText(1000).optional().nullable(),
});

export const InvoiceCreateSchema = z.object({
  number: zReqText(60),
  issuedOn: zDate,
  amount: zMoney.refine((v) => Number(v) > 0, 'AMOUNT_POSITIVE'),
  currency: z.enum(CURRENCIES),
  paymentTermDays: z.number().int().min(0).max(365).optional(),
});

export const PaymentCreateSchema = z.object({
  paidOn: zDate,
  amount: zMoney.refine((v) => Number(v) > 0, 'AMOUNT_POSITIVE'),
  currency: z.enum(CURRENCIES),
  reference: zText(200).optional().nullable(),
});

export const CollectionCompleteSchema = z.object({ outcome: zReqText(2000) });

// ---------- tickets (eDo-like) ----------

export const TicketCreateSchema = z.object({
  accountId: zUuid,
  number: zReqText(40),
  title: zReqText(300),
  priority: z.enum(TICKET_PRIORITIES),
  status: z.enum(TICKET_STATUSES).default('OPEN'),
  ballIn: z.enum(BALL_IN).default('WHALE'),
  orgHolder: zText(100).optional().nullable(),
  ownerName: zText(100).optional().nullable(),
  slaDueOn: zDate.optional().nullable(),
  openedOn: zDate,
  notes: zText(4000).optional().nullable(),
});
export type TicketCreate = z.input<typeof TicketCreateSchema>;
export const TicketUpdateSchema = TicketCreateSchema.partial().omit({ accountId: true });

// ---------- misc ----------

export const FxRateCreateSchema = z.object({
  month: zDate.refine((d) => d.endsWith('-01'), 'MONTH_FIRST_DAY'),
  currency: z.enum(CURRENCIES),
  unitsPerUsd: zDecimal.refine((v) => Number(v) > 0, 'RATE_POSITIVE'),
  kind: z.enum(FX_KINDS).default('ACTUAL'),
  source: zText(100).optional().nullable(),
});

export const AuditQuerySchema = zPagination.extend({
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  opportunityId: zUuid.optional(),
  category: z.enum(AUDIT_CATEGORIES).optional(),
});

export const DocStatusSchema = z.enum(DOC_STATUSES);
