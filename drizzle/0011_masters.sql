CREATE TYPE "public"."master_status" AS ENUM('pending', 'ready', 'rejected', 'aborted');--> statement-breakpoint
CREATE TABLE "masters" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"recording_id" uuid NOT NULL,
	"object_key" text NOT NULL,
	"format" text DEFAULT 'wav' NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text,
	"file_name" text NOT NULL,
	"status" "master_status" DEFAULT 'pending' NOT NULL,
	"upload_id" text,
	"uploaded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "masters_key_in_org" CHECK ("masters"."object_key" = 'orgs/' || "masters"."org_id"::text || '/recordings/' || "masters"."recording_id"::text || '/masters/' || "masters"."id"::text || '.wav'),
	CONSTRAINT "masters_format_wav" CHECK ("masters"."format" = 'wav'),
	CONSTRAINT "masters_size_positive" CHECK ("masters"."size_bytes" > 0),
	CONSTRAINT "masters_sha256_format" CHECK ("masters"."sha256" IS NULL OR "masters"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "masters_ready_complete" CHECK ("masters"."status" <> 'ready' OR ("masters"."sha256" IS NOT NULL AND "masters"."completed_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "masters" ADD CONSTRAINT "masters_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "masters" ADD CONSTRAINT "masters_recording_same_org_fk" FOREIGN KEY ("org_id","recording_id") REFERENCES "public"."recordings"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "masters_object_key_key" ON "masters" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "masters_org_recording_idx" ON "masters" USING btree ("org_id","recording_id","created_at");--> statement-breakpoint

-- RLS for masters, following 0006. Members read; owners and catalog managers (catalog:write
-- in src/lib/server/rbac.ts) record uploads. R2 itself is outside RLS: ERMS signs URLs only
-- for keys under the caller's org, and masters_key_in_org ties every key to its row's org.
ALTER TABLE masters ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY masters_member_read ON masters FOR SELECT USING (app.is_member(org_id));--> statement-breakpoint
CREATE POLICY masters_catalog_insert ON masters FOR INSERT TO erms_app WITH CHECK (
	app.has_role(org_id, ARRAY['owner', 'catalog_manager']) AND uploaded_by = app.current_user_id()::text
);--> statement-breakpoint
CREATE POLICY masters_catalog_update ON masters FOR UPDATE TO erms_app USING (app.has_role(org_id, ARRAY['owner', 'catalog_manager'])) WITH CHECK (app.has_role(org_id, ARRAY['owner', 'catalog_manager']));--> statement-breakpoint

-- No DELETE: a master row stays as the record of what was uploaded, even if rejected.
-- Only the upload's progress can change; the key, org, recording and declared size can't.
GRANT SELECT, INSERT ON masters TO erms_app;--> statement-breakpoint
GRANT UPDATE (status, sha256, upload_id, completed_at) ON masters TO erms_app;
