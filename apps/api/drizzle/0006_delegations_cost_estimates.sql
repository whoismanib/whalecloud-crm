CREATE TYPE "public"."resource_type" AS ENUM('CN_ONSITE_RD', 'CN_INTERNAL_RD', 'CN_REMOTE', 'LOCAL', 'TRAVEL');--> statement-breakpoint
CREATE TABLE "approval_delegations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"delegator_user_id" uuid NOT NULL,
	"delegate_user_id" uuid NOT NULL,
	"role" "user_role" NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"reason" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	CONSTRAINT "approval_delegations_range_chk" CHECK ("approval_delegations"."ends_on" >= "approval_delegations"."starts_on")
);
--> statement-breakpoint
CREATE TABLE "cost_estimates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"price_request_id" uuid NOT NULL,
	"area" text NOT NULL,
	"resource_type" "resource_type" NOT NULL,
	"person_months" numeric(8, 2),
	"mandatory" boolean DEFAULT true NOT NULL,
	"assignee_user_id" uuid NOT NULL,
	"signed_by" uuid,
	"signed_at" timestamp with time zone,
	"notes" text,
	CONSTRAINT "cost_estimates_pm_chk" CHECK ("cost_estimates"."person_months" IS NULL OR "cost_estimates"."person_months" >= 0)
);
--> statement-breakpoint
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_delegator_user_id_users_id_fk" FOREIGN KEY ("delegator_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_delegate_user_id_users_id_fk" FOREIGN KEY ("delegate_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_estimates" ADD CONSTRAINT "cost_estimates_price_request_id_price_requests_id_fk" FOREIGN KEY ("price_request_id") REFERENCES "public"."price_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_estimates" ADD CONSTRAINT "cost_estimates_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_estimates" ADD CONSTRAINT "cost_estimates_signed_by_users_id_fk" FOREIGN KEY ("signed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approval_delegations_delegator_idx" ON "approval_delegations" USING btree ("delegator_user_id","starts_on","ends_on");--> statement-breakpoint
CREATE INDEX "approval_delegations_delegate_idx" ON "approval_delegations" USING btree ("delegate_user_id","starts_on","ends_on");--> statement-breakpoint
CREATE INDEX "cost_estimates_pr_idx" ON "cost_estimates" USING btree ("price_request_id");--> statement-breakpoint
CREATE INDEX "cost_estimates_assignee_idx" ON "cost_estimates" USING btree ("assignee_user_id");--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wcrm_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON approval_delegations, cost_estimates TO wcrm_app';
  END IF;
END $$;
