CREATE TYPE "public"."compliance_answer" AS ENUM('COMPLIES', 'PARTIAL', 'NOT_COMPLIES', 'PENDING');--> statement-breakpoint
CREATE TYPE "public"."rfp_decision" AS ENUM('PENDING', 'PARTICIPATE', 'DECLINE');--> statement-breakpoint
CREATE TYPE "public"."rfp_result" AS ENUM('PENDING', 'WON', 'LOST', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."rfp_type" AS ENUM('RFI', 'RFP', 'RFQ');--> statement-breakpoint
CREATE TABLE "rfp_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"rfp_id" uuid NOT NULL,
	"ref" text,
	"requirement" text NOT NULL,
	"answer" "compliance_answer" DEFAULT 'PENDING' NOT NULL,
	"comment" text,
	"assignee_user_id" uuid,
	"answered_by" uuid,
	"answered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rfps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"type" "rfp_type" DEFAULT 'RFP' NOT NULL,
	"title" text NOT NULL,
	"received_on" date NOT NULL,
	"client_deadline" date NOT NULL,
	"internal_deadline" date NOT NULL,
	"documents_url" text,
	"notes" text,
	"decision" "rfp_decision" DEFAULT 'PENDING' NOT NULL,
	"decision_due_on" date NOT NULL,
	"decision_reason" text,
	"decided_on" date,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"cm_reviewed_by" uuid,
	"cm_reviewed_at" timestamp with time zone,
	"cm_review_comment" text,
	"delivered_on" date,
	"delivered_at" timestamp with time zone,
	"result" "rfp_result" DEFAULT 'PENDING' NOT NULL,
	"winning_competitor" text,
	"winning_price" numeric(18, 2),
	"winning_price_currency" "currency_code",
	"winning_price_usd" numeric(18, 2),
	"winning_price_cny" numeric(18, 2),
	"winning_price_clp" numeric(18, 0),
	"winning_price_fx_month" date,
	"winning_price_fx_provisional" boolean DEFAULT false NOT NULL,
	"compliance_pct" numeric(7, 4),
	CONSTRAINT "rfps_deadline_chk" CHECK ("rfps"."client_deadline" >= "rfps"."received_on"),
	CONSTRAINT "rfps_delivered_reviewed_chk" CHECK ("rfps"."delivered_at" IS NULL OR "rfps"."cm_reviewed_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "rfp_requirements" ADD CONSTRAINT "rfp_requirements_rfp_id_rfps_id_fk" FOREIGN KEY ("rfp_id") REFERENCES "public"."rfps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfp_requirements" ADD CONSTRAINT "rfp_requirements_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfp_requirements" ADD CONSTRAINT "rfp_requirements_answered_by_users_id_fk" FOREIGN KEY ("answered_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfps" ADD CONSTRAINT "rfps_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfps" ADD CONSTRAINT "rfps_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfps" ADD CONSTRAINT "rfps_cm_reviewed_by_users_id_fk" FOREIGN KEY ("cm_reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rfp_requirements_rfp_idx" ON "rfp_requirements" USING btree ("rfp_id");--> statement-breakpoint
CREATE INDEX "rfp_requirements_assignee_idx" ON "rfp_requirements" USING btree ("assignee_user_id");--> statement-breakpoint
CREATE INDEX "rfps_opportunity_idx" ON "rfps" USING btree ("opportunity_id");--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wcrm_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON rfps, rfp_requirements TO wcrm_app';
  END IF;
END $$;
