CREATE TYPE "public"."activity_source" AS ENUM('MANUAL', 'LEGACY_MAIL_CACHE', 'MAIL_SYNC');--> statement-breakpoint
CREATE TYPE "public"."topic_state" AS ENUM('ACTIVE', 'ON_HOLD', 'CLOSED');--> statement-breakpoint
ALTER TYPE "public"."import_kind" ADD VALUE 'LEGACY_MAIL_CACHE';--> statement-breakpoint
CREATE TABLE "engagement_topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"row_version" integer DEFAULT 1 NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"source" "activity_source" NOT NULL,
	"external_key" text NOT NULL,
	"account_id" uuid NOT NULL,
	"opportunity_id" uuid,
	"client_label" text NOT NULL,
	"section" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"state" "topic_state" DEFAULT 'ACTIVE' NOT NULL,
	"state_reason" text,
	"edo_refs" text[] DEFAULT '{}' NOT NULL,
	"edo_last_update_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mail_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source" "activity_source" NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"window_days" integer NOT NULL,
	"inbox_count" integer NOT NULL,
	"sent_count" integer NOT NULL,
	"calendar_count" integer NOT NULL,
	"matched_count" integer NOT NULL,
	"meetings_matched" integer NOT NULL,
	"upcoming_matched" integer NOT NULL,
	"unmatched_count" integer NOT NULL,
	"unmatched_events" integer NOT NULL,
	"import_job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "source" "activity_source" DEFAULT 'MANUAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "external_key" text;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "direction" text;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "item_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "topic_id" uuid;--> statement-breakpoint
ALTER TABLE "engagement_topics" ADD CONSTRAINT "engagement_topics_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_topics" ADD CONSTRAINT "engagement_topics_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_snapshots" ADD CONSTRAINT "mail_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "engagement_topics_owner_key_uq" ON "engagement_topics" USING btree ("owner_user_id","source","external_key");--> statement-breakpoint
CREATE INDEX "engagement_topics_account_idx" ON "engagement_topics" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_snapshots_user_generated_uq" ON "mail_snapshots" USING btree ("user_id","source","generated_at");--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_topic_id_engagement_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."engagement_topics"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_topic_id_idx" ON "activities" USING btree ("topic_id");--> statement-breakpoint
CREATE UNIQUE INDEX "activities_source_external_key_uq" ON "activities" USING btree ("source","external_key") WHERE external_key IS NOT NULL;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_direction_check" CHECK ("activities"."direction" IS NULL OR "activities"."direction" IN ('IN','OUT'));--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_item_count_check" CHECK ("activities"."item_count" >= 1);--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wcrm_app') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON engagement_topics, mail_snapshots TO wcrm_app';
  END IF;
END $$;
