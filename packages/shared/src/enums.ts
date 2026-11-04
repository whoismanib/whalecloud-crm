// Enum values shared by DB (pgEnum), API and web. Codes are English; UI translates them.

export const USER_ROLES = [
  'COUNTRY_MANAGER',
  'ACCOUNT_MANAGER',
  'CHINA_SALES',
  'CHINA_DELIVERY',
  'LOCAL_DELIVERY',
  'CHINA_FINANCE',
  'CHINA_LEGAL',
  'VP',
  'LATAM_PRESIDENT',
  'ADMIN',
] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const PROCESS_CODES = [
  'P1',
  'P2',
  'P3',
  'P4',
  'P5',
  'P6',
  'P7',
  'P8',
  'P9',
  'P10',
  'P11',
  'P12',
  'P13',
  'P14',
  'P15',
  'P16',
  'DASH',
  'ADM',
] as const;
export type ProcessCode = (typeof PROCESS_CODES)[number];

export const RACI_LETTERS = ['R', 'A', 'C', 'I'] as const;
export type RaciLetter = (typeof RACI_LETTERS)[number];

export const CURRENCIES = ['USD', 'CNY', 'CLP', 'COP', 'MXN', 'BOB'] as const;
export type Currency = (typeof CURRENCIES)[number];

export const FX_KINDS = ['ACTUAL', 'BUDGET'] as const;
export type FxKind = (typeof FX_KINDS)[number];

export const VERTICALS = [
  'TELECOM_BSS',
  'TELECOM_OSS',
  'AI',
  'FINTECH',
  'CLOUD_DATA',
  'ENERGY',
  'ROBOTICS',
] as const;
export type Vertical = (typeof VERTICALS)[number];

export const BILLING_ENGINES = ['A', 'B', 'C', 'D', 'E'] as const;
export type BillingEngine = (typeof BILLING_ENGINES)[number];

export const CUSTOMER_TYPES = ['EXISTING', 'NEW'] as const;
export type CustomerType = (typeof CUSTOMER_TYPES)[number];

export const LEAD_ORIGINS = [
  'EVENT',
  'REFERRAL',
  'DISTRIBUTOR',
  'PUBLIC_RFI',
  'INBOUND',
  'OUTBOUND',
  'OTHER',
] as const;
export type LeadOrigin = (typeof LEAD_ORIGINS)[number];

export const OPPORTUNITY_STATUSES = ['OPEN', 'LOST', 'DISCARDED', 'NOT_QUOTED'] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

export const FORECAST_CATEGORIES = ['COMMIT', 'PROBABLE', 'PIPELINE'] as const;
export type ForecastCategory = (typeof FORECAST_CATEGORIES)[number];

export const QUAL_STATUSES = ['EMPTY', 'PARTIAL', 'COMPLETE'] as const;
export type QualStatus = (typeof QUAL_STATUSES)[number];

export const CONTACT_ROLES = [
  'ECONOMIC_BUYER',
  'SPONSOR',
  'CHAMPION',
  'DECISION_MAKER',
  'TECHNICAL_EVALUATOR',
  'END_USER',
  'PROCUREMENT',
  'LEGAL',
  'INFLUENCER',
  'BLOCKER',
  'ACCOUNTS_PAYABLE',
  'CONTRACT_OWNER',
  'FINANCE_MANAGER',
] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number];

export const ACTIVITY_TYPES = ['MEETING', 'CALL', 'EMAIL', 'DEMO', 'EVENT', 'OTHER'] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const DOC_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];

export const PRICE_REQUEST_TYPES = ['PROJECT', 'CR'] as const;
export type PriceRequestType = (typeof PRICE_REQUEST_TYPES)[number];

export const PRICE_REQUEST_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'COSTING',
  'BUILDING',
  'READY_FOR_APPROVAL',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
] as const;
export type PriceRequestStatus = (typeof PRICE_REQUEST_STATUSES)[number];

export const RELATIONSHIP_TYPES = ['NEW_CUSTOMER', 'EXISTING_CUSTOMER'] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export const COMPETITION_TYPES = ['TENDER_3_PLUS', 'INVITED_FEW', 'DIRECT'] as const;
export type CompetitionType = (typeof COMPETITION_TYPES)[number];

export const SIGNING_MODELS = [
  'SINGLE_CL_SPA',
  'SPLIT_SW_CN_SERVICES_CL',
  'SPLIT_SW_SG_SERVICES_CL',
  'OTHER',
] as const;
export type SigningModel = (typeof SIGNING_MODELS)[number];

export const LINE_ITEM_TYPES = [
  'HARDWARE',
  'THIRD_PARTY_SOFTWARE',
  'OWN_SOFTWARE',
  'IMPLEMENTATION',
  'WARRANTY',
  'SUPPORT_L3',
  'SUPPORT_L1L2',
] as const;
export type LineItemType = (typeof LINE_ITEM_TYPES)[number];

export const CAPEX_OPEX = ['CAPEX', 'OPEX', 'OPTIONAL'] as const;
export type CapexOpex = (typeof CAPEX_OPEX)[number];

export const MILESTONE_SOURCES = ['CASHFLOW', 'TC', 'EXPECTED'] as const;
export type MilestoneSource = (typeof MILESTONE_SOURCES)[number];

export const MILESTONE_TRIGGERS = [
  'SIGNATURE',
  'SRS_DONE',
  'UAT',
  'GO_LIVE',
  'DELIVERY',
  'TERM_START',
  'PERIOD_END',
  'QUARTERLY_ADVANCE',
  'PO_RECEPTION',
  'OTHER',
] as const;
export type MilestoneTrigger = (typeof MILESTONE_TRIGGERS)[number];

export const APPROVAL_BANDS = ['COMMITTEE', 'PRESIDENT', 'VP', 'NOT_QUOTABLE'] as const;
export type ApprovalBand = (typeof APPROVAL_BANDS)[number];

export const APPROVAL_STEP_KINDS = [
  'MARGIN_COMMITTEE',
  'MARGIN_PRESIDENT',
  'MARGIN_VP',
  'VP_CO_APPROVAL',
  'NON_ECONOMIC',
  'CM_PRICE_MANUAL',
] as const;
export type ApprovalStepKind = (typeof APPROVAL_STEP_KINDS)[number];

export const APPROVAL_STATUSES = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CHANGES_REQUESTED',
  'EXPIRED',
  'INVALIDATED',
  'CANCELLED',
] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const NON_ECONOMIC_CONDITIONS = [
  'PAYMENT_TERM_OVER_60',
  'CLP_WITHOUT_FX_PREMIUM',
  'PENALTY_OVER_10',
  'UNLIMITED_LIABILITY',
] as const;
export type NonEconomicCondition = (typeof NON_ECONOMIC_CONDITIONS)[number];

export const CONTRACT_TYPES = ['NDA', 'MSA', 'SOW', 'OC', 'CR'] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];

export const CONTRACT_STATUSES = [
  'DRAFT',
  'IN_LEGAL_REVIEW',
  'SIGNED',
  'ACTIVE',
  'EXPIRED',
  'TERMINATED',
  'CANCELLED',
] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const RECOGNITION_MODES = ['PER_MILESTONE', 'FINAL_AC_ONLY'] as const;
export type RecognitionMode = (typeof RECOGNITION_MODES)[number];

export const MILESTONE_STATUSES = [
  'PLANNED',
  'READY',
  'ACCEPTED',
  'SENT_TO_FINANCE',
  'INVOICED',
  'PARTIALLY_PAID',
  'PAID',
  'CANCELLED',
] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export const EVIDENCE_TYPES = [
  'ACCEPTANCE_EMAIL',
  'MSA',
  'SIGNED_AC',
  'RECEPTION',
  'PO',
  'TERM_START',
  'USAGE_REPORT',
  'PERIOD_ELAPSED',
  'DELIVERY_NOTE',
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export const SIGNATURE_TYPES = [
  'HANDWRITTEN_SCAN',
  'ADVANCED_ESIGN',
  'SIMPLE_ESIGN',
  'EMAIL',
] as const;
export type SignatureType = (typeof SIGNATURE_TYPES)[number];

export const INVOICE_STATUSES = ['ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const COLLECTION_STEPS = [
  'D_MINUS_10',
  'D_PLUS_1',
  'D_PLUS_7',
  'D_PLUS_15',
  'D_PLUS_30',
] as const;
export type CollectionStep = (typeof COLLECTION_STEPS)[number];

export const ACTION_STATUSES = ['PENDING', 'DONE', 'SKIPPED', 'CANCELLED'] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export const DOC_KINDS = [
  'NDA',
  'MSA',
  'SOW',
  'OC',
  'CR',
  'AC',
  'REC',
  'INV',
  'PROP',
  'BC',
  'SHEET',
  'BRD',
  'RFP',
  'TC',
  'USAGE',
  'OTHER',
] as const;
export type DocKind = (typeof DOC_KINDS)[number];

export const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const LEGACY_STATUSES = [
  'PO',
  'Voucher',
  'TP Sent',
  'Preparing TP',
  'RFP Sent',
  'Preparing RFP',
  'PVB',
  'Cancelled',
] as const;
export type LegacyStatus = (typeof LEGACY_STATUSES)[number];

// eDo-like incident tickets (legacy "Incidentes eDo" page).
export const TICKET_PRIORITIES = ['P1', 'P2', 'P3', 'P4'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_STATUSES = [
  'OPEN',
  'IN_PROGRESS',
  'PENDING_CLIENT',
  'RESOLVED',
  'CLOSED',
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const BALL_IN = ['WHALE', 'CLIENT'] as const;
export type BallIn = (typeof BALL_IN)[number];

export const HEALTH_STATUSES = [
  'HEALTHY',
  'AT_RISK',
  'CRITICAL',
  'STALE',
  'ON_HOLD',
  'CLOSED',
] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

// ---------- Mail / calendar sync (ADR 0008) ----------
/** Where an activity came from: typed by a user, the legacy `crm_cache.json`, or a mail sync. */
export const ACTIVITY_SOURCES = ['MANUAL', 'LEGACY_MAIL_CACHE', 'MAIL_SYNC'] as const;
export type ActivitySource = (typeof ACTIVITY_SOURCES)[number];

export const ACTIVITY_DIRECTIONS = ['IN', 'OUT'] as const;
export type ActivityDirection = (typeof ACTIVITY_DIRECTIONS)[number];

/** State of an engagement topic (legacy taxonomy project): only ACTIVE topics count for the score. */
export const TOPIC_STATES = ['ACTIVE', 'ON_HOLD', 'CLOSED'] as const;
export type TopicState = (typeof TOPIC_STATES)[number];

/** Labels of the legacy "Salud CRM" per project (crm_scoring.py `status_label`). */
export const ENGAGEMENT_STATUSES = [
  'HEALTHY',
  'AT_RISK',
  'CRITICAL',
  'STALE',
  'DORMANT',
  'SCHEDULED',
  'IN_PROGRESS',
  'ON_HOLD',
  'RESOLVED',
  'CLOSED',
] as const;
export type EngagementStatus = (typeof ENGAGEMENT_STATUSES)[number];

export const AUDIT_ACTIONS = [
  'CREATE',
  'UPDATE',
  'ARCHIVE',
  'STAGE_CHANGE',
  'APPROVAL_REQUEST',
  'APPROVAL_DECISION',
  'EXCEPTION',
  'LOGIN',
  'LOGIN_FAILED',
  'LOGOUT',
  'MFA_ENROLL',
  'MFA_RESET',
  'PASSWORD_CHANGE',
  'EXPORT',
  'IMPORT',
  'FILE_UPLOAD',
  'SETTING_CHANGE',
  'RACI_CHANGE',
  'FX_CHANGE',
  'ANONYMIZE',
  'SNAPSHOT',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_CATEGORIES = [
  'PRICE',
  'SCOPE',
  'STAGE',
  'APPROVAL',
  'EXCEPTION',
  'CONTRACT',
  'BILLING',
  'COLLECTION',
  'SECURITY',
  'CONFIG',
  'DATA',
  'EXPORT',
] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export const LOCALES = ['es-CL', 'en', 'zh-CN'] as const;
export type Locale = (typeof LOCALES)[number];

// ---------- Phase 2 (P9–P16) ----------
export const ACCOUNT_REVIEW_KINDS = ['QUARTERLY', 'EDO_MONTHLY'] as const;
export type AccountReviewKind = (typeof ACCOUNT_REVIEW_KINDS)[number];

export const RENEWAL_STATUSES = [
  'SCHEDULED',
  'OPPORTUNITY_CREATED',
  'QUOTED',
  'RENEWED',
  'NOT_RENEWED',
] as const;
export type RenewalStatus = (typeof RENEWAL_STATUSES)[number];

export const CR_STATUSES = [
  'DRAFT',
  'QUOTED',
  'PO_RECEIVED',
  'IN_PROGRESS',
  'RECEIVED',
  'INVOICED',
  'CANCELLED',
] as const;
export type CrStatus = (typeof CR_STATUSES)[number];

export const REGISTRATION_STATUSES = [
  'SUBMITTED',
  'CONFLICT_REVIEW',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

export const DISTRIBUTOR_STATUSES = ['PROSPECT', 'ACTIVE', 'INACTIVE'] as const;
export type DistributorStatus = (typeof DISTRIBUTOR_STATUSES)[number];

export const COMPLIANCE_SECTIONS = [
  'DATA_PROTECTION',
  'ANTI_CORRUPTION',
  'PUBLIC_TENDER',
  'EXPORT_CONTROL',
] as const;
export type ComplianceSection = (typeof COMPLIANCE_SECTIONS)[number];

export const CHECKLIST_STATUSES = [
  'DRAFT',
  'IN_REVIEW',
  'REVIEWED',
  'APPROVED',
  'REJECTED',
] as const;
export type ChecklistStatus = (typeof CHECKLIST_STATUSES)[number];

export const YES_NO_NA = ['YES', 'NO', 'NA'] as const;
export type YesNoNa = (typeof YES_NO_NA)[number];

export const ONBOARDING_ITEMS = [
  'MANUAL',
  'TEMPLATES',
  'STANDARD_DEMO',
  'ACCESS_CRM',
  'ACCESS_EDO',
  'ACCESS_ZMP',
  'ACCESS_FOL',
] as const;
export type OnboardingItem = (typeof ONBOARDING_ITEMS)[number];

export const CAPACITY_ALERTS = ['NONE', 'WARN_80', 'CRITICAL_100'] as const;
export type CapacityAlert = (typeof CAPACITY_ALERTS)[number];

export const IMPORT_KINDS = [
  'ACCOUNTS',
  'OPPORTUNITIES',
  'INVOICES',
  'LEGACY_TRACKER',
  'ZMP_HOURS',
  'EDO_INCIDENTS',
  'LEGACY_MAIL_CACHE',
] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

// ---------- P3 Preventa (QA-004) ----------
export const RFP_TYPES = ['RFI', 'RFP', 'RFQ'] as const;
export type RfpType = (typeof RFP_TYPES)[number];
export const RFP_DECISIONS = ['PENDING', 'PARTICIPATE', 'DECLINE'] as const;
export type RfpDecision = (typeof RFP_DECISIONS)[number];
export const RFP_RESULTS = ['PENDING', 'WON', 'LOST', 'CANCELLED'] as const;
export type RfpResult = (typeof RFP_RESULTS)[number];
export const COMPLIANCE_ANSWERS = ['COMPLIES', 'PARTIAL', 'NOT_COMPLIES', 'PENDING'] as const;
export type ComplianceAnswer = (typeof COMPLIANCE_ANSWERS)[number];

// ---------- P5-04 cost estimates (QA-008) ----------
export const RESOURCE_TYPES = [
  'CN_ONSITE_RD',
  'CN_INTERNAL_RD',
  'CN_REMOTE',
  'LOCAL',
  'TRAVEL',
] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];
