CREATE TYPE "public"."account_review_kind" AS ENUM('QUARTERLY', 'EDO_MONTHLY');--> statement-breakpoint
CREATE TYPE "public"."capacity_alert" AS ENUM('NONE', 'WARN_80', 'CRITICAL_100');--> statement-breakpoint
CREATE TYPE "public"."checklist_status" AS ENUM('DRAFT', 'IN_REVIEW', 'REVIEWED', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."compliance_section" AS ENUM('DATA_PROTECTION', 'ANTI_CORRUPTION', 'PUBLIC_TENDER', 'EXPORT_CONTROL');--> statement-breakpoint
CREATE TYPE "public"."cr_status" AS ENUM('DRAFT', 'QUOTED', 'PO_RECEIVED', 'IN_PROGRESS', 'RECEIVED', 'INVOICED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."import_kind" AS ENUM('ACCOUNTS', 'OPPORTUNITIES', 'INVOICES', 'LEGACY_TRACKER', 'ZMP_HOURS');--> statement-breakpoint
CREATE TYPE "public"."onboarding_item" AS ENUM('MANUAL', 'TEMPLATES', 'STANDARD_DEMO', 'ACCESS_CRM', 'ACCESS_EDO', 'ACCESS_ZMP', 'ACCESS_FOL');--> statement-breakpoint
CREATE TYPE "public"."registration_status" AS ENUM('SUBMITTED', 'CONFLICT_REVIEW', 'APPROVED', 'REJECTED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."renewal_status" AS ENUM('SCHEDULED', 'OPPORTUNITY_CREATED', 'QUOTED', 'RENEWED', 'NOT_RENEWED');--> statement-breakpoint
CREATE TYPE "public"."yes_no_na" AS ENUM('YES', 'NO', 'NA');--> statement-breakpoint
CREATE TABLE "account_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"account_id" uuid NOT NULL,
	"year" smallint NOT NULL,
	"status" "doc_status" DEFAULT 'DRAFT' NOT NULL,
	"objectives" text,
	"growth_opportunities" text,
	"contact_map" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"risks" text,
	"target" numeric(18, 2),
	"target_currency" "currency_code",
	"target_usd" numeric(18, 2),
	"target_cny" numeric(18, 2),
	"target_clp" numeric(18, 0),
	"target_fx_month" date,
	"target_fx_provisional" boolean DEFAULT false NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "account_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" "account_review_kind" NOT NULL,
	"period_start" date NOT NULL,
	"held_on" date NOT NULL,
	"findings" text NOT NULL,
	"actions" text,
	"edo_ticket_stats" jsonb
);
--> statement-breakpoint
CREATE TABLE "change_request_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"change_request_id" uuid NOT NULL,
	"profile" text NOT NULL,
	"hours" numeric(8, 2) NOT NULL,
	"rate" numeric(18, 2) NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"rate_card_id" uuid
);
--> statement-breakpoint
CREATE TABLE "change_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"code" text NOT NULL,
	"account_id" uuid NOT NULL,
	"parent_contract_id" uuid NOT NULL,
	"opportunity_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"status" "cr_status" DEFAULT 'DRAFT' NOT NULL,
	"amount" numeric(18, 2),
	"amount_currency" "currency_code",
	"amount_usd" numeric(18, 2),
	"amount_cny" numeric(18, 2),
	"amount_clp" numeric(18, 0),
	"amount_fx_month" date,
	"amount_fx_provisional" boolean DEFAULT false NOT NULL,
	"po_contract_id" uuid,
	"po_received_on" date,
	"work_started_on" date,
	"reception_on" date,
	"cm_exception" boolean DEFAULT false NOT NULL,
	"exception_reason" text,
	"exception_expires_on" date,
	"exception_by" uuid,
	CONSTRAINT "change_requests_code_unique" UNIQUE("code"),
	CONSTRAINT "change_requests_exception_check" CHECK (NOT "change_requests"."cm_exception" OR ("change_requests"."exception_reason" IS NOT NULL AND "change_requests"."exception_expires_on" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "compliance_checklists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "checklist_status" DEFAULT 'DRAFT' NOT NULL,
	"required_sections" "compliance_section"[] NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_comment" text,
	"approved_by" uuid,
	"approved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "compliance_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"checklist_id" uuid NOT NULL,
	"section" "compliance_section" NOT NULL,
	"item_code" text NOT NULL,
	"answer" "yes_no_na",
	"required" boolean NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "deal_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"distributor_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"opportunity_id" uuid,
	"registered_on" date NOT NULL,
	"status" "registration_status" DEFAULT 'SUBMITTED' NOT NULL,
	"conflicting_opportunity_ids" uuid[] DEFAULT '{}' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"notes" text,
	"expires_on" date
);
--> statement-breakpoint
CREATE TABLE "distributor_agreements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"distributor_id" uuid NOT NULL,
	"territories" text[] DEFAULT '{}' NOT NULL,
	"verticals" "vertical"[] DEFAULT '{}' NOT NULL,
	"products" text,
	"margin_pct" numeric(7, 6),
	"starts_on" date,
	"ends_on" date,
	"status" text DEFAULT 'ACTIVE' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "distributor_trainings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"distributor_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"held_on" date NOT NULL,
	"product" text,
	"attendees" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "distributors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"tax_id" text,
	"country_code" char(2) NOT NULL,
	"contact_name" text,
	"contact_email" "citext",
	"status" text DEFAULT 'PROSPECT' NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "forecast_snapshot_items" (
	"snapshot_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"name" text NOT NULL,
	"account_name" text NOT NULL,
	"owner_id" uuid,
	"stage" smallint NOT NULL,
	"status" "opportunity_status" NOT NULL,
	"forecast_category" "forecast_category",
	"customer_type" text,
	"amount_cny" numeric(18, 2),
	"amount_usd" numeric(18, 2),
	"expected_close_date" date NOT NULL,
	"probability" numeric(5, 4),
	CONSTRAINT "forecast_snapshot_items_snapshot_id_opportunity_id_pk" PRIMARY KEY("snapshot_id","opportunity_id")
);
--> statement-breakpoint
CREATE TABLE "forecast_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"iso_year" smallint NOT NULL,
	"iso_week" smallint NOT NULL,
	"country_code" char(2) NOT NULL,
	"taken_on" date NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	"taken_by" uuid,
	"totals" jsonb NOT NULL,
	"kpis" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hours_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"month" date NOT NULL,
	"po_id" uuid,
	"po_number_raw" text NOT NULL,
	"resident_name" text NOT NULL,
	"hours" numeric(8, 2) NOT NULL,
	"excess_hours" numeric(8, 2) DEFAULT '0' NOT NULL,
	"without_po" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hours_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"month" date NOT NULL,
	"rows_ok" integer DEFAULT 0 NOT NULL,
	"rows_error" integer DEFAULT 0 NOT NULL,
	"report" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"kind" "import_kind" NOT NULL,
	"dry_run" boolean DEFAULT false NOT NULL,
	"rows_total" integer DEFAULT 0 NOT NULL,
	"rows_ok" integer DEFAULT 0 NOT NULL,
	"rows_error" integer DEFAULT 0 NOT NULL,
	"report" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title_key" text NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"link" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"emailed_at" timestamp with time zone,
	"dedupe_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_checklists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"user_id" uuid NOT NULL,
	"country_code" char(2) NOT NULL,
	"start_date" date NOT NULL,
	"productive_target_on" date NOT NULL,
	"productive_at" date,
	CONSTRAINT "onboarding_checklists_userId_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "onboarding_items" (
	"checklist_id" uuid NOT NULL,
	"item" "onboarding_item" NOT NULL,
	"done_at" timestamp with time zone,
	"done_by" uuid,
	"notes" text,
	CONSTRAINT "onboarding_items_checklist_id_item_pk" PRIMARY KEY("checklist_id","item")
);
--> statement-breakpoint
CREATE TABLE "onboarding_kits" (
	"country_code" char(2) PRIMARY KEY NOT NULL,
	"items" "onboarding_item"[] NOT NULL,
	"productive_days" smallint DEFAULT 30 NOT NULL,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"account_id" uuid,
	"contract_id" uuid,
	"profile" text NOT NULL,
	"rate" numeric(18, 2) NOT NULL,
	"currency" "currency_code" NOT NULL,
	"unit" text DEFAULT 'HOUR' NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date
);
--> statement-breakpoint
CREATE TABLE "renewals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"contract_id" uuid NOT NULL,
	"end_date" date NOT NULL,
	"create_on" date NOT NULL,
	"quote_by" date NOT NULL,
	"renewal_opportunity_id" uuid,
	"status" "renewal_status" DEFAULT 'SCHEDULED' NOT NULL,
	"quoted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "resident_pos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"contract_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"po_number" text NOT NULL,
	"total_hours" numeric(10, 2) NOT NULL,
	"valid_from" date,
	"valid_to" date,
	"consumed_hours" numeric(10, 2) DEFAULT '0' NOT NULL,
	"alert_level" "capacity_alert" DEFAULT 'NONE' NOT NULL,
	CONSTRAINT "resident_pos_contractId_unique" UNIQUE("contract_id"),
	CONSTRAINT "resident_pos_poNumber_unique" UNIQUE("po_number")
);
--> statement-breakpoint
ALTER TABLE "handoffs" ADD COLUMN "commercial_sheet_reviewed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "handoffs" ADD COLUMN "sow_reviewed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "handoffs" ADD COLUMN "milestones_reviewed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "handoffs" ADD COLUMN "acceptance_criteria_reviewed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "handoffs" ADD COLUMN "sow_attachment_id" uuid;--> statement-breakpoint
ALTER TABLE "collection_actions" ADD COLUMN "notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "account_plans" ADD CONSTRAINT "account_plans_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_plans" ADD CONSTRAINT "account_plans_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_reviews" ADD CONSTRAINT "account_reviews_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_request_lines" ADD CONSTRAINT "change_request_lines_change_request_id_change_requests_id_fk" FOREIGN KEY ("change_request_id") REFERENCES "public"."change_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_request_lines" ADD CONSTRAINT "change_request_lines_rate_card_id_rate_cards_id_fk" FOREIGN KEY ("rate_card_id") REFERENCES "public"."rate_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_parent_contract_id_contracts_id_fk" FOREIGN KEY ("parent_contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_po_contract_id_contracts_id_fk" FOREIGN KEY ("po_contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_exception_by_users_id_fk" FOREIGN KEY ("exception_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_checklists" ADD CONSTRAINT "compliance_checklists_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_checklists" ADD CONSTRAINT "compliance_checklists_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_checklists" ADD CONSTRAINT "compliance_checklists_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_items" ADD CONSTRAINT "compliance_items_checklist_id_compliance_checklists_id_fk" FOREIGN KEY ("checklist_id") REFERENCES "public"."compliance_checklists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_registrations" ADD CONSTRAINT "deal_registrations_distributor_id_distributors_id_fk" FOREIGN KEY ("distributor_id") REFERENCES "public"."distributors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_registrations" ADD CONSTRAINT "deal_registrations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_registrations" ADD CONSTRAINT "deal_registrations_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_registrations" ADD CONSTRAINT "deal_registrations_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distributor_agreements" ADD CONSTRAINT "distributor_agreements_distributor_id_distributors_id_fk" FOREIGN KEY ("distributor_id") REFERENCES "public"."distributors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distributor_trainings" ADD CONSTRAINT "distributor_trainings_distributor_id_distributors_id_fk" FOREIGN KEY ("distributor_id") REFERENCES "public"."distributors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distributors" ADD CONSTRAINT "distributors_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "forecast_snapshot_items" ADD CONSTRAINT "forecast_snapshot_items_snapshot_id_forecast_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."forecast_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hours_entries" ADD CONSTRAINT "hours_entries_import_id_hours_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."hours_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hours_entries" ADD CONSTRAINT "hours_entries_po_id_resident_pos_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."resident_pos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_checklists" ADD CONSTRAINT "onboarding_checklists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_items" ADD CONSTRAINT "onboarding_items_checklist_id_onboarding_checklists_id_fk" FOREIGN KEY ("checklist_id") REFERENCES "public"."onboarding_checklists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_kits" ADD CONSTRAINT "onboarding_kits_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_cards" ADD CONSTRAINT "rate_cards_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_cards" ADD CONSTRAINT "rate_cards_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewals" ADD CONSTRAINT "renewals_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "renewals" ADD CONSTRAINT "renewals_renewal_opportunity_id_opportunities_id_fk" FOREIGN KEY ("renewal_opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resident_pos" ADD CONSTRAINT "resident_pos_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resident_pos" ADD CONSTRAINT "resident_pos_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_plans_account_year_uq" ON "account_plans" USING btree ("account_id","year");--> statement-breakpoint
CREATE UNIQUE INDEX "account_reviews_uq" ON "account_reviews" USING btree ("account_id","kind","period_start");--> statement-breakpoint
CREATE UNIQUE INDEX "compliance_checklists_opp_version_uq" ON "compliance_checklists" USING btree ("opportunity_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "compliance_items_uq" ON "compliance_items" USING btree ("checklist_id","item_code");--> statement-breakpoint
CREATE UNIQUE INDEX "forecast_snapshots_week_uq" ON "forecast_snapshots" USING btree ("iso_year","iso_week","country_code");--> statement-breakpoint
CREATE UNIQUE INDEX "hours_entries_uq" ON "hours_entries" USING btree ("month","po_number_raw","resident_name");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_user_dedupe_uq" ON "notifications" USING btree ("user_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "notifications_user_read_idx" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "rate_cards_contract_profile_idx" ON "rate_cards" USING btree ("contract_id","profile","valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX "renewals_contract_end_uq" ON "renewals" USING btree ("contract_id","end_date");--> statement-breakpoint
CREATE INDEX "renewals_quote_by_idx" ON "renewals" USING btree ("quote_by");