CREATE EXTENSION IF NOT EXISTS pgcrypto;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS citext;--> statement-breakpoint
CREATE TYPE "public"."action_status" AS ENUM('PENDING', 'DONE', 'SKIPPED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."activity_type" AS ENUM('MEETING', 'CALL', 'EMAIL', 'DEMO', 'EVENT', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."approval_band" AS ENUM('COMMITTEE', 'PRESIDENT', 'VP', 'NOT_QUOTABLE');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'EXPIRED', 'INVALIDATED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."approval_step_kind" AS ENUM('MARGIN_COMMITTEE', 'MARGIN_PRESIDENT', 'MARGIN_VP', 'VP_CO_APPROVAL', 'NON_ECONOMIC', 'CM_PRICE_MANUAL');--> statement-breakpoint
CREATE TYPE "public"."audit_action" AS ENUM('CREATE', 'UPDATE', 'ARCHIVE', 'STAGE_CHANGE', 'APPROVAL_REQUEST', 'APPROVAL_DECISION', 'EXCEPTION', 'LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'MFA_ENROLL', 'MFA_RESET', 'PASSWORD_CHANGE', 'EXPORT', 'IMPORT', 'FILE_UPLOAD', 'SETTING_CHANGE', 'RACI_CHANGE', 'FX_CHANGE', 'ANONYMIZE', 'SNAPSHOT');--> statement-breakpoint
CREATE TYPE "public"."audit_category" AS ENUM('PRICE', 'SCOPE', 'STAGE', 'APPROVAL', 'EXCEPTION', 'CONTRACT', 'BILLING', 'COLLECTION', 'SECURITY', 'CONFIG', 'DATA', 'EXPORT');--> statement-breakpoint
CREATE TYPE "public"."ball_in" AS ENUM('WHALE', 'CLIENT');--> statement-breakpoint
CREATE TYPE "public"."billing_engine" AS ENUM('A', 'B', 'C', 'D', 'E');--> statement-breakpoint
CREATE TYPE "public"."capex_opex" AS ENUM('CAPEX', 'OPEX', 'OPTIONAL');--> statement-breakpoint
CREATE TYPE "public"."collection_step" AS ENUM('D_MINUS_10', 'D_PLUS_1', 'D_PLUS_7', 'D_PLUS_15', 'D_PLUS_30');--> statement-breakpoint
CREATE TYPE "public"."competition_type" AS ENUM('TENDER_3_PLUS', 'INVITED_FEW', 'DIRECT');--> statement-breakpoint
CREATE TYPE "public"."contact_role" AS ENUM('ECONOMIC_BUYER', 'SPONSOR', 'CHAMPION', 'DECISION_MAKER', 'TECHNICAL_EVALUATOR', 'END_USER', 'PROCUREMENT', 'LEGAL', 'INFLUENCER', 'BLOCKER', 'ACCOUNTS_PAYABLE', 'CONTRACT_OWNER', 'FINANCE_MANAGER');--> statement-breakpoint
CREATE TYPE "public"."contract_status" AS ENUM('DRAFT', 'IN_LEGAL_REVIEW', 'SIGNED', 'ACTIVE', 'EXPIRED', 'TERMINATED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."contract_type" AS ENUM('NDA', 'MSA', 'SOW', 'OC', 'CR');--> statement-breakpoint
CREATE TYPE "public"."currency_code" AS ENUM('USD', 'CNY', 'CLP', 'COP', 'MXN', 'BOB');--> statement-breakpoint
CREATE TYPE "public"."customer_type" AS ENUM('EXISTING', 'NEW');--> statement-breakpoint
CREATE TYPE "public"."doc_kind" AS ENUM('NDA', 'MSA', 'SOW', 'OC', 'CR', 'AC', 'REC', 'INV', 'PROP', 'BC', 'SHEET', 'BRD', 'RFP', 'TC', 'USAGE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."doc_status" AS ENUM('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."evidence_type" AS ENUM('ACCEPTANCE_EMAIL', 'MSA', 'SIGNED_AC', 'RECEPTION', 'PO', 'TERM_START', 'USAGE_REPORT', 'PERIOD_ELAPSED', 'DELIVERY_NOTE');--> statement-breakpoint
CREATE TYPE "public"."forecast_category" AS ENUM('COMMIT', 'PROBABLE', 'PIPELINE');--> statement-breakpoint
CREATE TYPE "public"."fx_kind" AS ENUM('ACTUAL', 'BUDGET');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."lead_origin" AS ENUM('EVENT', 'REFERRAL', 'DISTRIBUTOR', 'PUBLIC_RFI', 'INBOUND', 'OUTBOUND', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."line_item_type" AS ENUM('HARDWARE', 'THIRD_PARTY_SOFTWARE', 'OWN_SOFTWARE', 'IMPLEMENTATION', 'WARRANTY', 'SUPPORT_L3', 'SUPPORT_L1L2');--> statement-breakpoint
CREATE TYPE "public"."milestone_source" AS ENUM('CASHFLOW', 'TC', 'EXPECTED');--> statement-breakpoint
CREATE TYPE "public"."milestone_status" AS ENUM('PLANNED', 'READY', 'ACCEPTED', 'SENT_TO_FINANCE', 'INVOICED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."milestone_trigger" AS ENUM('SIGNATURE', 'SRS_DONE', 'UAT', 'GO_LIVE', 'DELIVERY', 'TERM_START', 'PERIOD_END', 'QUARTERLY_ADVANCE', 'PO_RECEPTION', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."non_economic_condition" AS ENUM('PAYMENT_TERM_OVER_60', 'CLP_WITHOUT_FX_PREMIUM', 'PENALTY_OVER_10', 'UNLIMITED_LIABILITY');--> statement-breakpoint
CREATE TYPE "public"."opportunity_status" AS ENUM('OPEN', 'LOST', 'DISCARDED', 'NOT_QUOTED');--> statement-breakpoint
CREATE TYPE "public"."price_request_status" AS ENUM('DRAFT', 'SUBMITTED', 'COSTING', 'BUILDING', 'READY_FOR_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."price_request_type" AS ENUM('PROJECT', 'CR');--> statement-breakpoint
CREATE TYPE "public"."process_code" AS ENUM('P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10', 'P11', 'P12', 'P13', 'P14', 'P15', 'P16', 'DASH', 'ADM');--> statement-breakpoint
CREATE TYPE "public"."qual_status" AS ENUM('EMPTY', 'PARTIAL', 'COMPLETE');--> statement-breakpoint
CREATE TYPE "public"."raci_letter" AS ENUM('R', 'A', 'C', 'I');--> statement-breakpoint
CREATE TYPE "public"."recognition_mode" AS ENUM('PER_MILESTONE', 'FINAL_AC_ONLY');--> statement-breakpoint
CREATE TYPE "public"."relationship_type" AS ENUM('NEW_CUSTOMER', 'EXISTING_CUSTOMER');--> statement-breakpoint
CREATE TYPE "public"."risk_level" AS ENUM('LOW', 'MEDIUM', 'HIGH');--> statement-breakpoint
CREATE TYPE "public"."signature_type" AS ENUM('HANDWRITTEN_SCAN', 'ADVANCED_ESIGN', 'SIMPLE_ESIGN', 'EMAIL');--> statement-breakpoint
CREATE TYPE "public"."signing_model" AS ENUM('SINGLE_CL_SPA', 'SPLIT_SW_CN_SERVICES_CL', 'SPLIT_SW_SG_SERVICES_CL', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."ticket_priority" AS ENUM('P1', 'P2', 'P3', 'P4');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('OPEN', 'IN_PROGRESS', 'PENDING_CLIENT', 'RESOLVED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('COUNTRY_MANAGER', 'ACCOUNT_MANAGER', 'CHINA_SALES', 'CHINA_DELIVERY', 'LOCAL_DELIVERY', 'CHINA_FINANCE', 'CHINA_LEGAL', 'VP', 'LATAM_PRESIDENT', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."vertical" AS ENUM('TELECOM_BSS', 'TELECOM_OSS', 'AI', 'FINTECH', 'CLOUD_DATA', 'ENERGY', 'ROBOTICS');--> statement-breakpoint
CREATE TABLE "billing_entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"code" text NOT NULL,
	"legal_name" text NOT NULL,
	"country_code" char(2) NOT NULL,
	"tax_id" text,
	"vat_pct" numeric(7, 6) NOT NULL,
	"withholding_pct" numeric(7, 6) NOT NULL,
	"currency" "currency_code" NOT NULL,
	"is_importer" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "billing_entities_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "calendars" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"timezone" text NOT NULL,
	"weekend_days" smallint[] DEFAULT '{0,6}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "countries" (
	"code" char(2) PRIMARY KEY NOT NULL,
	"name_es" text NOT NULL,
	"name_en" text NOT NULL,
	"name_zh" text NOT NULL,
	"default_currency" "currency_code" NOT NULL,
	"calendar_id" text NOT NULL,
	"vat_pct" numeric(7, 6),
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"month" date NOT NULL,
	"currency" "currency_code" NOT NULL,
	"units_per_usd" numeric(18, 6) NOT NULL,
	"kind" "fx_kind" DEFAULT 'ACTUAL' NOT NULL,
	"source" text,
	"loaded_by" uuid,
	"loaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_rates_month_first_day" CHECK (extract(day from "fx_rates"."month") = 1),
	CONSTRAINT "fx_rates_positive" CHECK ("fx_rates"."units_per_usd" > 0)
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"calendar_id" text NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"is_workday" boolean DEFAULT false NOT NULL,
	CONSTRAINT "holidays_calendar_id_date_pk" PRIMARY KEY("calendar_id","date")
);
--> statement-breakpoint
CREATE TABLE "raci_entries" (
	"raci_version_id" integer NOT NULL,
	"process" "process_code" NOT NULL,
	"role" "user_role" NOT NULL,
	"letters" "raci_letter"[] DEFAULT '{}' NOT NULL,
	CONSTRAINT "raci_entries_raci_version_id_process_role_pk" PRIMARY KEY("raci_version_id","process","role")
);
--> statement-breakpoint
CREATE TABLE "raci_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"comment" text,
	CONSTRAINT "raci_versions_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"csrf_token" text NOT NULL,
	"mfa_verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" "inet",
	"user_agent" text,
	CONSTRAINT "sessions_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "settings_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_by" uuid
);
--> statement-breakpoint
CREATE TABLE "targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"kpi_code" text NOT NULL,
	"year" smallint NOT NULL,
	"segment" text DEFAULT 'TOTAL' NOT NULL,
	"value" numeric(18, 2),
	"unit" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role" "user_role" NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by" uuid,
	CONSTRAINT "user_roles_user_id_role_pk" PRIMARY KEY("user_id","role")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"email" "citext" NOT NULL,
	"full_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"mfa_secret_enc" text,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"locale" text DEFAULT 'es-CL' NOT NULL,
	"timezone" text DEFAULT 'America/Santiago' NOT NULL,
	"calendar_id" text DEFAULT 'CL' NOT NULL,
	"country_codes" text[] DEFAULT '{CL}' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"deactivated_at" timestamp with time zone,
	"joined_on" date,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_locale_check" CHECK ("users"."locale" IN ('es-CL','zh-CN','en'))
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"legal_name" text,
	"tax_id" text,
	"country_code" char(2) NOT NULL,
	"vertical" "vertical" NOT NULL,
	"customer_type" "customer_type" NOT NULL,
	"default_billing_entity_id" uuid NOT NULL,
	"currency" "currency_code" NOT NULL,
	"is_key_account" boolean DEFAULT false NOT NULL,
	"accepts_simple_esign" boolean DEFAULT false NOT NULL,
	"new_work_suspended" boolean DEFAULT false NOT NULL,
	"suspended_at" timestamp with time zone,
	"suspended_reason" text,
	"owner_id" uuid NOT NULL,
	"website" text,
	"notes" text,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"account_id" uuid NOT NULL,
	"opportunity_id" uuid,
	"type" "activity_type" NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"subject" text NOT NULL,
	"notes" text,
	"contact_ids" uuid[] DEFAULT '{}' NOT NULL,
	"user_ids" uuid[] DEFAULT '{}' NOT NULL,
	"outcome" text
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"account_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"job_title" text,
	"email" "citext",
	"phone" text,
	"mobile" text,
	"buying_roles" "contact_role"[] DEFAULT '{}' NOT NULL,
	"preferred_language" text,
	"consent_status" text DEFAULT 'UNKNOWN' NOT NULL,
	"consent_at" timestamp with time zone,
	"anonymized_at" timestamp with time zone,
	"notes" text,
	"archived_at" timestamp with time zone,
	CONSTRAINT "contacts_consent_status_check" CHECK ("contacts"."consent_status" IN ('UNKNOWN','GRANTED','WITHDRAWN'))
);
--> statement-breakpoint
CREATE TABLE "business_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "doc_status" DEFAULT 'DRAFT' NOT NULL,
	"pain" text,
	"baseline_metric" text,
	"benefit" text,
	"tco_horizon_years" smallint,
	"tco" numeric(18, 2),
	"tco_currency" "currency_code",
	"tco_usd" numeric(18, 2),
	"tco_cny" numeric(18, 2),
	"tco_clp" numeric(18, 0),
	"tco_fx_month" date,
	"tco_fx_provisional" boolean DEFAULT false NOT NULL,
	"roi_pct" numeric(9, 4),
	"payback_months" numeric(6, 1),
	"risks" text,
	"strategic_value" text,
	"submitted_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"decision_comment" text,
	"finance_consulted_by" uuid,
	"finance_comment" text,
	CONSTRAINT "business_cases_tco_horizon_check" CHECK ("business_cases"."tco_horizon_years" IS NULL OR "business_cases"."tco_horizon_years" BETWEEN 3 AND 5)
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"account_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"country_code" char(2) NOT NULL,
	"vertical" "vertical" NOT NULL,
	"billing_engine" "billing_engine" NOT NULL,
	"origin" "lead_origin" NOT NULL,
	"distributor_id" uuid,
	"stage" smallint DEFAULT 0 NOT NULL,
	"status" "opportunity_status" DEFAULT 'OPEN' NOT NULL,
	"stage_entered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"amount" numeric(18, 2),
	"amount_currency" "currency_code",
	"amount_usd" numeric(18, 2),
	"amount_cny" numeric(18, 2),
	"amount_clp" numeric(18, 0),
	"amount_fx_month" date,
	"amount_fx_provisional" boolean DEFAULT false NOT NULL,
	"expected_close_date" date NOT NULL,
	"decision_date" date,
	"first_contact_date" date NOT NULL,
	"registered_late" boolean DEFAULT false NOT NULL,
	"forecast_category" "forecast_category",
	"risk" "risk_level",
	"legacy_status" text,
	"on_hold" boolean DEFAULT false NOT NULL,
	"pain" text,
	"sponsor_contact_id" uuid,
	"decision_criteria" text,
	"competitors" text[] DEFAULT '{}' NOT NULL,
	"customer_type_frozen" "customer_type",
	"counts_as_digital" boolean NOT NULL,
	"digital_overridden" boolean DEFAULT false NOT NULL,
	"is_renewal" boolean DEFAULT false NOT NULL,
	"uses_business_case" boolean DEFAULT false NOT NULL,
	"current_price_request_id" uuid,
	"current_sheet_version_id" uuid,
	"china_sheet_version_label" text,
	"current_approval_request_id" uuid,
	"approved_net_margin" numeric(7, 6),
	"approved_contract_margin" numeric(7, 6),
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"approval_expires_on" date,
	"china_system_contract_id" text,
	"zmp_project_id" text,
	"won_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"close_reason" text,
	"winning_competitor" text,
	"winning_price" numeric(18, 2),
	"winning_price_currency" "currency_code",
	"winning_price_usd" numeric(18, 2),
	"winning_price_cny" numeric(18, 2),
	"winning_price_clp" numeric(18, 0),
	"winning_price_fx_month" date,
	"winning_price_fx_provisional" boolean DEFAULT false NOT NULL,
	"last_activity_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	CONSTRAINT "opportunities_code_unique" UNIQUE("code"),
	CONSTRAINT "opportunities_stage_check" CHECK ("opportunities"."stage" BETWEEN 0 AND 11),
	CONSTRAINT "opportunities_distributor_check" CHECK ("opportunities"."origin" <> 'DISTRIBUTOR' OR "opportunities"."distributor_id" IS NOT NULL),
	CONSTRAINT "opportunities_close_reason_check" CHECK ("opportunities"."status" = 'OPEN' OR "opportunities"."close_reason" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "opportunity_assignments" (
	"opportunity_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opportunity_assignments_opportunity_id_user_id_reason_pk" PRIMARY KEY("opportunity_id","user_id","reason")
);
--> statement-breakpoint
CREATE TABLE "opportunity_contacts" (
	"opportunity_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"roles" "contact_role"[] DEFAULT '{}' NOT NULL,
	CONSTRAINT "opportunity_contacts_opportunity_id_contact_id_pk" PRIMARY KEY("opportunity_id","contact_id")
);
--> statement-breakpoint
CREATE TABLE "opportunity_qualifications" (
	"opportunity_id" uuid PRIMARY KEY NOT NULL,
	"bant_budget" "qual_status" DEFAULT 'EMPTY' NOT NULL,
	"bant_authority" "qual_status" DEFAULT 'EMPTY' NOT NULL,
	"bant_need" "qual_status" DEFAULT 'EMPTY' NOT NULL,
	"bant_timeline" "qual_status" DEFAULT 'EMPTY' NOT NULL,
	"m_metrics" "qual_status" DEFAULT 'EMPTY' NOT NULL,
	"m_economic_buyer" "qual_status" DEFAULT 'EMPTY' NOT NULL,
	"m_decision_criteria" "qual_status" DEFAULT 'EMPTY' NOT NULL,
	"m_decision_process" "qual_status" DEFAULT 'EMPTY' NOT NULL,
	"m_paper_process" "qual_status" DEFAULT 'EMPTY' NOT NULL,
	"m_identify_pain" "qual_status" DEFAULT 'EMPTY' NOT NULL,
	"m_champion" "qual_status" DEFAULT 'EMPTY' NOT NULL,
	"m_competition" "qual_status" DEFAULT 'EMPTY' NOT NULL,
	"notes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"meddpicc_score" numeric(4, 3),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "stage_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"from_stage" smallint,
	"to_stage" smallint NOT NULL,
	"from_status" "opportunity_status",
	"to_status" "opportunity_status" NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_by" uuid,
	"reason" text,
	"derived" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_request_expected_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"price_request_id" uuid NOT NULL,
	"seq" smallint NOT NULL,
	"pct" numeric(5, 2) NOT NULL,
	"trigger" "milestone_trigger" NOT NULL,
	"trigger_text" text,
	CONSTRAINT "price_request_expected_milestones_pct" CHECK ("price_request_expected_milestones"."pct" > 0 AND "price_request_expected_milestones"."pct" <= 100)
);
--> statement-breakpoint
CREATE TABLE "price_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"type" "price_request_type" NOT NULL,
	"status" "price_request_status" DEFAULT 'DRAFT' NOT NULL,
	"country_code" char(2),
	"account_id" uuid,
	"relationship_type" "relationship_type",
	"competition_type" "competition_type",
	"sales_owner_id" uuid,
	"solution_owner_name" text,
	"solution_owner_id" uuid,
	"delivery_owner_name" text,
	"delivery_owner_id" uuid,
	"project_stage_label" text,
	"project_level" text,
	"budget" numeric(18, 2),
	"budget_currency" "currency_code",
	"budget_usd" numeric(18, 2),
	"budget_cny" numeric(18, 2),
	"budget_clp" numeric(18, 0),
	"budget_fx_month" date,
	"budget_fx_provisional" boolean DEFAULT false NOT NULL,
	"signing_model" "signing_model",
	"currency" "currency_code",
	"warranty_months" smallint,
	"summary" text,
	"strategy" text,
	"main_competitor" text,
	"risks" text,
	"scope_summary" text,
	"assumptions" text,
	"exclusions" text,
	"brd_attachment_id" uuid,
	"billing_engine" "billing_engine",
	"target_price" numeric(18, 2),
	"target_price_currency" "currency_code",
	"target_price_usd" numeric(18, 2),
	"target_price_cny" numeric(18, 2),
	"target_price_clp" numeric(18, 0),
	"target_price_fx_month" date,
	"target_price_fx_provisional" boolean DEFAULT false NOT NULL,
	"target_competitor" text,
	"submitted_at" timestamp with time zone,
	"sla_days" smallint,
	"sla_due_on" date,
	"sla_paused_business_days" numeric(6, 1) DEFAULT '0' NOT NULL,
	"sheet_approved_at" timestamp with time zone,
	"versions_count" smallint DEFAULT 0 NOT NULL,
	"current_holder_role" "user_role",
	CONSTRAINT "price_requests_submit_check" CHECK ("price_requests"."status" = 'DRAFT' OR "price_requests"."status" = 'CANCELLED' OR ("price_requests"."scope_summary" IS NOT NULL AND "price_requests"."billing_engine" IS NOT NULL AND "price_requests"."target_price" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "sheet_line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"sheet_version_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"block" text,
	"item_type" "line_item_type" NOT NULL,
	"capex_opex" "capex_opex" NOT NULL,
	"description" text,
	"quantity" numeric(12, 2) DEFAULT '1' NOT NULL,
	"cost" numeric(18, 2) NOT NULL,
	"target_margin" numeric(7, 6) NOT NULL,
	"price_ex_tax" numeric(18, 2) NOT NULL,
	"net_income" numeric(18, 2) NOT NULL,
	"commercial_costs" numeric(18, 2) DEFAULT '0' NOT NULL,
	"net_margin" numeric(7, 6),
	"contract_margin" numeric(7, 6),
	"band" "approval_band",
	"support_years" smallint,
	CONSTRAINT "sheet_line_items_cost_check" CHECK ("sheet_line_items"."cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sheet_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sheet_version_id" uuid NOT NULL,
	"source" "milestone_source" NOT NULL,
	"seq" smallint NOT NULL,
	"pct" numeric(5, 2) NOT NULL,
	"trigger" "milestone_trigger" NOT NULL,
	"trigger_text" text,
	"expected_quarter" text
);
--> statement-breakpoint
CREATE TABLE "sheet_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"price_request_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"version_label" text NOT NULL,
	"version_seq" integer NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"file_attachment_id" uuid,
	"currency" "currency_code" NOT NULL,
	"total_price_ex_tax" numeric(18, 2),
	"total_cost" numeric(18, 2),
	"total_net_income" numeric(18, 2),
	"total_commercial_costs" numeric(18, 2),
	"net_margin" numeric(7, 6),
	"contract_margin" numeric(7, 6),
	"min_line_net_margin" numeric(7, 6),
	"proposed_band" "approval_band",
	"offer_validity_days" smallint DEFAULT 30 NOT NULL,
	"payment_term_days" smallint,
	"clp_without_fx_premium" boolean DEFAULT false NOT NULL,
	"penalty_cap_pct" numeric(7, 6),
	"unlimited_liability" boolean DEFAULT false NOT NULL,
	"tc_entities" text,
	"fx_params" jsonb,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"sheet_version_id" uuid NOT NULL,
	"status" "approval_status" DEFAULT 'PENDING' NOT NULL,
	"band" "approval_band" NOT NULL,
	"margin_basis" text NOT NULL,
	"net_margin" numeric(7, 6),
	"contract_margin" numeric(7, 6),
	"min_line_margin" numeric(7, 6),
	"competitive_justification" text,
	"business_case_id" uuid,
	"conditions" "non_economic_condition"[] DEFAULT '{}' NOT NULL,
	"rules_snapshot" jsonb NOT NULL,
	"requested_by" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"valid_days" smallint DEFAULT 60 NOT NULL,
	"expires_on" date,
	"invalidated_at" timestamp with time zone,
	"invalidation_reason" text,
	"is_exception" boolean DEFAULT false NOT NULL,
	CONSTRAINT "approval_requests_band_check" CHECK ("approval_requests"."band" <> 'NOT_QUOTABLE'),
	CONSTRAINT "approval_requests_basis_check" CHECK ("approval_requests"."margin_basis" IN ('NET_INCOME','CONTRACT'))
);
--> statement-breakpoint
CREATE TABLE "approval_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"approval_request_id" uuid NOT NULL,
	"seq" smallint NOT NULL,
	"kind" "approval_step_kind" NOT NULL,
	"condition" "non_economic_condition",
	"assignee_role" "user_role" NOT NULL,
	"assignee_user_id" uuid,
	"consulted_roles" "user_role"[] DEFAULT '{}' NOT NULL,
	"informed_roles" "user_role"[] DEFAULT '{}' NOT NULL,
	"status" "approval_status" DEFAULT 'PENDING' NOT NULL,
	"due_on" date,
	"decided_by" uuid,
	"on_behalf_of_user_id" uuid,
	"decided_at" timestamp with time zone,
	"comment" text,
	"evidence_attachment_id" uuid,
	CONSTRAINT "approval_steps_reject_comment_check" CHECK ("approval_steps"."status" NOT IN ('REJECTED','CHANGES_REQUESTED') OR "approval_steps"."comment" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"storage_driver" text DEFAULT 'link' NOT NULL,
	"storage_key" text,
	"is_external_link" boolean DEFAULT true NOT NULL,
	"external_url" text,
	"original_name" text,
	"standard_name" text NOT NULL,
	"name_country" char(2),
	"name_client" text,
	"doc_kind" "doc_kind",
	"doc_number" text,
	"version_label" text,
	"doc_date" date,
	"mime_type" text,
	"size_bytes" bigint,
	"entity_type" text,
	"entity_id" uuid,
	"account_id" uuid,
	"opportunity_id" uuid,
	"contract_id" uuid,
	CONSTRAINT "attachments_storageKey_unique" UNIQUE("storage_key"),
	CONSTRAINT "attachments_external_url_check" CHECK (NOT "attachments"."is_external_link" OR "attachments"."external_url" ~ '^https://')
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"account_id" uuid NOT NULL,
	"opportunity_id" uuid,
	"parent_contract_id" uuid,
	"type" "contract_type" NOT NULL,
	"number" text,
	"title" text NOT NULL,
	"status" "contract_status" DEFAULT 'DRAFT' NOT NULL,
	"signing_model" "signing_model",
	"billing_entity_id" uuid NOT NULL,
	"secondary_billing_entity_id" uuid,
	"billing_engine" "billing_engine",
	"signed_on" date,
	"start_date" date,
	"end_date" date,
	"renewable" boolean DEFAULT false NOT NULL,
	"auto_renew" boolean DEFAULT false NOT NULL,
	"amount" numeric(18, 2),
	"amount_currency" "currency_code",
	"amount_usd" numeric(18, 2),
	"amount_cny" numeric(18, 2),
	"amount_clp" numeric(18, 0),
	"amount_fx_month" date,
	"amount_fx_provisional" boolean DEFAULT false NOT NULL,
	"counts_for_ss" boolean NOT NULL,
	"recognition_mode" "recognition_mode" DEFAULT 'PER_MILESTONE' NOT NULL,
	"repository_url" text,
	"signed_attachment_id" uuid,
	"repository_uploaded_at" timestamp with time zone,
	"china_system_id" text,
	"renewal_notice_days" smallint,
	CONSTRAINT "contracts_nda_ss_check" CHECK ("contracts"."type" <> 'NDA' OR NOT "contracts"."counts_for_ss"),
	CONSTRAINT "contracts_repository_check" CHECK ("contracts"."status" NOT IN ('SIGNED','ACTIVE') OR "contracts"."repository_url" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "handoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"contract_id" uuid,
	"due_on" date,
	"meeting_at" timestamp with time zone,
	"attendee_user_ids" uuid[] DEFAULT '{}' NOT NULL,
	"external_attendees" text,
	"acceptance_criteria" text,
	"zmp_project_id" text,
	"planned_start" date,
	"actual_start" date,
	"notes" text,
	CONSTRAINT "handoffs_opportunityId_unique" UNIQUE("opportunity_id")
);
--> statement-breakpoint
CREATE TABLE "collection_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"invoice_id" uuid NOT NULL,
	"step" "collection_step" NOT NULL,
	"scheduled_on" date NOT NULL,
	"responsible_role" "user_role" NOT NULL,
	"assignee_user_id" uuid,
	"notified_roles" "user_role"[] DEFAULT '{}' NOT NULL,
	"status" "action_status" DEFAULT 'PENDING' NOT NULL,
	"done_at" timestamp with time zone,
	"done_by" uuid,
	"outcome" text,
	"job_key" text NOT NULL,
	CONSTRAINT "collection_actions_jobKey_unique" UNIQUE("job_key")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"billing_line_id" uuid NOT NULL,
	"milestone_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"billing_entity_id" uuid NOT NULL,
	"number" text NOT NULL,
	"issued_on" date NOT NULL,
	"amount" numeric(18, 2),
	"amount_currency" "currency_code",
	"amount_usd" numeric(18, 2),
	"amount_cny" numeric(18, 2),
	"amount_clp" numeric(18, 0),
	"amount_fx_month" date,
	"amount_fx_provisional" boolean DEFAULT false NOT NULL,
	"payment_term_days" smallint,
	"due_on" date NOT NULL,
	"balance" numeric(18, 2) NOT NULL,
	"status" "invoice_status" DEFAULT 'ISSUED' NOT NULL,
	"attachment_id" uuid
);
--> statement-breakpoint
CREATE TABLE "milestone_billing_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"milestone_id" uuid NOT NULL,
	"line_no" smallint NOT NULL,
	"billing_entity_id" uuid NOT NULL,
	"description" text,
	"amount" numeric(18, 2),
	"amount_currency" "currency_code",
	"amount_usd" numeric(18, 2),
	"amount_cny" numeric(18, 2),
	"amount_clp" numeric(18, 0),
	"amount_fx_month" date,
	"amount_fx_provisional" boolean DEFAULT false NOT NULL,
	"vat_pct" numeric(7, 6),
	"withholding_pct" numeric(7, 6),
	CONSTRAINT "milestone_billing_lines_line_no" CHECK ("milestone_billing_lines"."line_no" BETWEEN 1 AND 4)
);
--> statement-breakpoint
CREATE TABLE "milestone_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"milestone_id" uuid NOT NULL,
	"evidence_type" "evidence_type" NOT NULL,
	"attachment_id" uuid NOT NULL,
	"received_on" date,
	"signature_type" "signature_type",
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"contract_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"seq" smallint NOT NULL,
	"name" text NOT NULL,
	"pct" numeric(5, 2),
	"amount" numeric(18, 2),
	"amount_currency" "currency_code",
	"amount_usd" numeric(18, 2),
	"amount_cny" numeric(18, 2),
	"amount_clp" numeric(18, 0),
	"amount_fx_month" date,
	"amount_fx_provisional" boolean DEFAULT false NOT NULL,
	"trigger" "milestone_trigger",
	"billing_engine" "billing_engine" NOT NULL,
	"acceptance_criteria" text,
	"planned_date" date,
	"ready_at" timestamp with time zone,
	"ac_due_on" date,
	"acceptance_email_at" timestamp with time zone,
	"ac_signed_at" date,
	"reception_at" date,
	"recognized_on" date,
	"sent_to_finance_at" timestamp with time zone,
	"invoice_due_on" date,
	"period_start" date,
	"period_end" date,
	"status" "milestone_status" DEFAULT 'PLANNED' NOT NULL,
	"is_final" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"invoice_id" uuid NOT NULL,
	"paid_on" date NOT NULL,
	"amount" numeric(18, 2),
	"amount_currency" "currency_code",
	"amount_usd" numeric(18, 2),
	"amount_cny" numeric(18, 2),
	"amount_clp" numeric(18, 0),
	"amount_fx_month" date,
	"amount_fx_provisional" boolean DEFAULT false NOT NULL,
	"reference" text,
	CONSTRAINT "payments_amount_positive" CHECK ("payments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"account_id" uuid NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"priority" "ticket_priority" NOT NULL,
	"status" "ticket_status" DEFAULT 'OPEN' NOT NULL,
	"ball_in" "ball_in" DEFAULT 'WHALE' NOT NULL,
	"org_holder" text,
	"owner_name" text,
	"sla_due_on" date,
	"opened_on" date NOT NULL,
	"last_update_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_on" date,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"actor_roles" "user_role"[] DEFAULT '{}' NOT NULL,
	"on_behalf_of_user_id" uuid,
	"action" "audit_action" NOT NULL,
	"category" "audit_category" NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"opportunity_id" uuid,
	"account_id" uuid,
	"changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reason" text,
	"request_id" text,
	"ip" "inet",
	"user_agent" text,
	"prev_hash" "bytea",
	"hash" "bytea" NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_entities" ADD CONSTRAINT "billing_entities_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "countries" ADD CONSTRAINT "countries_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raci_entries" ADD CONSTRAINT "raci_entries_raci_version_id_raci_versions_id_fk" FOREIGN KEY ("raci_version_id") REFERENCES "public"."raci_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_calendar_id_calendars_id_fk" FOREIGN KEY ("calendar_id") REFERENCES "public"."calendars"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_default_billing_entity_id_billing_entities_id_fk" FOREIGN KEY ("default_billing_entity_id") REFERENCES "public"."billing_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_cases" ADD CONSTRAINT "business_cases_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_cases" ADD CONSTRAINT "business_cases_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_sponsor_contact_id_contacts_id_fk" FOREIGN KEY ("sponsor_contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_assignments" ADD CONSTRAINT "opportunity_assignments_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_assignments" ADD CONSTRAINT "opportunity_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_contacts" ADD CONSTRAINT "opportunity_contacts_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_contacts" ADD CONSTRAINT "opportunity_contacts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_qualifications" ADD CONSTRAINT "opportunity_qualifications_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_history" ADD CONSTRAINT "stage_history_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_request_expected_milestones" ADD CONSTRAINT "price_request_expected_milestones_price_request_id_price_requests_id_fk" FOREIGN KEY ("price_request_id") REFERENCES "public"."price_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_requests" ADD CONSTRAINT "price_requests_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_requests" ADD CONSTRAINT "price_requests_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_requests" ADD CONSTRAINT "price_requests_sales_owner_id_users_id_fk" FOREIGN KEY ("sales_owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_line_items" ADD CONSTRAINT "sheet_line_items_sheet_version_id_sheet_versions_id_fk" FOREIGN KEY ("sheet_version_id") REFERENCES "public"."sheet_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_milestones" ADD CONSTRAINT "sheet_milestones_sheet_version_id_sheet_versions_id_fk" FOREIGN KEY ("sheet_version_id") REFERENCES "public"."sheet_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_versions" ADD CONSTRAINT "sheet_versions_price_request_id_price_requests_id_fk" FOREIGN KEY ("price_request_id") REFERENCES "public"."price_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sheet_versions" ADD CONSTRAINT "sheet_versions_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_sheet_version_id_sheet_versions_id_fk" FOREIGN KEY ("sheet_version_id") REFERENCES "public"."sheet_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_business_case_id_business_cases_id_fk" FOREIGN KEY ("business_case_id") REFERENCES "public"."business_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_approval_request_id_approval_requests_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_billing_entity_id_billing_entities_id_fk" FOREIGN KEY ("billing_entity_id") REFERENCES "public"."billing_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_secondary_billing_entity_id_billing_entities_id_fk" FOREIGN KEY ("secondary_billing_entity_id") REFERENCES "public"."billing_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_signed_attachment_id_attachments_id_fk" FOREIGN KEY ("signed_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_actions" ADD CONSTRAINT "collection_actions_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_actions" ADD CONSTRAINT "collection_actions_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_billing_line_id_milestone_billing_lines_id_fk" FOREIGN KEY ("billing_line_id") REFERENCES "public"."milestone_billing_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_billing_entity_id_billing_entities_id_fk" FOREIGN KEY ("billing_entity_id") REFERENCES "public"."billing_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone_billing_lines" ADD CONSTRAINT "milestone_billing_lines_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone_billing_lines" ADD CONSTRAINT "milestone_billing_lines_billing_entity_id_billing_entities_id_fk" FOREIGN KEY ("billing_entity_id") REFERENCES "public"."billing_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone_evidence" ADD CONSTRAINT "milestone_evidence_milestone_id_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."milestones"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestone_evidence" ADD CONSTRAINT "milestone_evidence_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "fx_rates_month_currency_kind_uq" ON "fx_rates" USING btree ("month","currency","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "raci_versions_active_uq" ON "raci_versions" USING btree ("is_active") WHERE "raci_versions"."is_active";--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "targets_kpi_year_segment_uq" ON "targets" USING btree ("kpi_code","year","segment");--> statement-breakpoint
CREATE INDEX "accounts_lower_name_idx" ON "accounts" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "accounts_owner_id_idx" ON "accounts" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "accounts_country_code_vertical_idx" ON "accounts" USING btree ("country_code","vertical");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_country_tax_id_uq" ON "accounts" USING btree ("country_code","tax_id") WHERE "accounts"."tax_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "activities_opportunity_id_occurred_at_idx" ON "activities" USING btree ("opportunity_id","occurred_at");--> statement-breakpoint
CREATE INDEX "activities_account_id_occurred_at_idx" ON "activities" USING btree ("account_id","occurred_at");--> statement-breakpoint
CREATE INDEX "contacts_account_id_idx" ON "contacts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "contacts_buying_roles_idx" ON "contacts" USING gin ("buying_roles");--> statement-breakpoint
CREATE INDEX "contacts_email_idx" ON "contacts" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "business_cases_opportunity_id_version_uq" ON "business_cases" USING btree ("opportunity_id","version");--> statement-breakpoint
CREATE INDEX "opportunities_status_stage_idx" ON "opportunities" USING btree ("status","stage");--> statement-breakpoint
CREATE INDEX "opportunities_owner_id_status_idx" ON "opportunities" USING btree ("owner_id","status");--> statement-breakpoint
CREATE INDEX "opportunities_account_id_idx" ON "opportunities" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "opportunities_expected_close_date_idx" ON "opportunities" USING btree ("expected_close_date") WHERE "opportunities"."status" = 'OPEN';--> statement-breakpoint
CREATE INDEX "opportunities_country_code_idx" ON "opportunities" USING btree ("country_code");--> statement-breakpoint
CREATE INDEX "opportunities_billing_engine_idx" ON "opportunities" USING btree ("billing_engine");--> statement-breakpoint
CREATE INDEX "opportunities_vertical_idx" ON "opportunities" USING btree ("vertical");--> statement-breakpoint
CREATE INDEX "stage_history_opportunity_id_changed_at_idx" ON "stage_history" USING btree ("opportunity_id","changed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "price_request_expected_milestones_seq_uq" ON "price_request_expected_milestones" USING btree ("price_request_id","seq");--> statement-breakpoint
CREATE INDEX "price_requests_opportunity_id_idx" ON "price_requests" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "price_requests_status_sla_due_on_idx" ON "price_requests" USING btree ("status","sla_due_on");--> statement-breakpoint
CREATE UNIQUE INDEX "sheet_line_items_line_no_uq" ON "sheet_line_items" USING btree ("sheet_version_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "sheet_milestones_uq" ON "sheet_milestones" USING btree ("sheet_version_id","source","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "sheet_versions_seq_uq" ON "sheet_versions" USING btree ("price_request_id","version_seq");--> statement-breakpoint
CREATE UNIQUE INDEX "sheet_versions_current_uq" ON "sheet_versions" USING btree ("price_request_id") WHERE "sheet_versions"."is_current";--> statement-breakpoint
CREATE INDEX "approval_requests_opportunity_id_status_idx" ON "approval_requests" USING btree ("opportunity_id","status");--> statement-breakpoint
CREATE INDEX "approval_requests_expires_on_idx" ON "approval_requests" USING btree ("expires_on") WHERE "approval_requests"."status" = 'APPROVED';--> statement-breakpoint
CREATE INDEX "approval_steps_assignee_user_id_status_idx" ON "approval_steps" USING btree ("assignee_user_id","status");--> statement-breakpoint
CREATE INDEX "approval_steps_assignee_role_status_idx" ON "approval_steps" USING btree ("assignee_role","status");--> statement-breakpoint
CREATE INDEX "approval_steps_request_idx" ON "approval_steps" USING btree ("approval_request_id");--> statement-breakpoint
CREATE INDEX "attachments_account_id_doc_kind_idx" ON "attachments" USING btree ("account_id","doc_kind");--> statement-breakpoint
CREATE INDEX "attachments_contract_id_idx" ON "attachments" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "attachments_opportunity_id_idx" ON "attachments" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "attachments_entity_idx" ON "attachments" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_standard_name_uq" ON "attachments" USING btree ("standard_name") WHERE NOT "attachments"."is_external_link";--> statement-breakpoint
CREATE INDEX "contracts_account_id_idx" ON "contracts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "contracts_opportunity_id_idx" ON "contracts" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "contracts_type_signed_on_idx" ON "contracts" USING btree ("type","signed_on");--> statement-breakpoint
CREATE UNIQUE INDEX "contracts_account_type_number_uq" ON "contracts" USING btree ("account_id","type","number") WHERE "contracts"."number" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "collection_actions_status_scheduled_on_idx" ON "collection_actions" USING btree ("status","scheduled_on");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_entity_number_uq" ON "invoices" USING btree ("billing_entity_id","number");--> statement-breakpoint
CREATE INDEX "invoices_due_on_idx" ON "invoices" USING btree ("due_on") WHERE "invoices"."balance" > 0;--> statement-breakpoint
CREATE INDEX "invoices_account_id_idx" ON "invoices" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "milestone_billing_lines_entity_uq" ON "milestone_billing_lines" USING btree ("milestone_id","billing_entity_id");--> statement-breakpoint
CREATE INDEX "milestone_evidence_milestone_type_idx" ON "milestone_evidence" USING btree ("milestone_id","evidence_type");--> statement-breakpoint
CREATE UNIQUE INDEX "milestones_contract_seq_uq" ON "milestones" USING btree ("contract_id","seq");--> statement-breakpoint
CREATE INDEX "milestones_opportunity_id_idx" ON "milestones" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "milestones_status_idx" ON "milestones" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payments_invoice_id_idx" ON "payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "payments_paid_on_idx" ON "payments" USING btree ("paid_on");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_account_number_uq" ON "tickets" USING btree ("account_id","number");--> statement-breakpoint
CREATE INDEX "tickets_status_idx" ON "tickets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_log_opportunity_idx" ON "audit_log" USING btree ("opportunity_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_log_category_idx" ON "audit_log" USING btree ("category","occurred_at");