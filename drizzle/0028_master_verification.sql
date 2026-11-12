ALTER TYPE "public"."master_status" ADD VALUE 'verifying' BEFORE 'ready';--> statement-breakpoint
ALTER TABLE "masters" ADD COLUMN "claimed_sha256" text;--> statement-breakpoint
ALTER TABLE "masters" ADD COLUMN "verify_token" uuid;--> statement-breakpoint
ALTER TABLE "masters" ADD COLUMN "verify_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "masters" ADD COLUMN "verify_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "masters" ADD CONSTRAINT "masters_claimed_sha256_format" CHECK ("masters"."claimed_sha256" IS NULL OR "masters"."claimed_sha256" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "masters" ADD CONSTRAINT "masters_verifying_claimed" CHECK ("masters"."status"::text <> 'verifying' OR "masters"."claimed_sha256" IS NOT NULL);--> statement-breakpoint

-- Server-side check of a master's SHA-256 (EPSILON-120). Completing an upload now records the
-- hash the browser reports in claimed_sha256 and sets the master to 'verifying'; a background step
-- hashes the object in R2 and sets it to 'ready' (with its own sha256) or rejects it. Existing rows
-- keep their status, and verify_attempts defaults to 0, so nothing changes for them.
-- The verify_* lease columns are written only on the owner connection, by the background step.
GRANT UPDATE (claimed_sha256) ON masters TO erms_app;
