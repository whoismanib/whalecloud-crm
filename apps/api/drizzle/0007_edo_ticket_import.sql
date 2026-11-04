ALTER TYPE "public"."import_kind" ADD VALUE 'EDO_INCIDENTS';--> statement-breakpoint
DROP INDEX "tickets_account_number_uq";--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "external_source" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "external_url" text;--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_external_uq" ON "tickets" USING btree ("external_source","external_id");--> statement-breakpoint
CREATE INDEX "tickets_account_number_idx" ON "tickets" USING btree ("account_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_account_number_uq" ON "tickets" USING btree ("account_id","number") WHERE "tickets"."external_id" IS NULL;