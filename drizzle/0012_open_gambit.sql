CREATE TYPE "public"."audiokit_job_status" AS ENUM('queued', 'submitted', 'succeeded', 'failed', 'canceled');--> statement-breakpoint
CREATE TABLE "audiokit_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"recording_id" uuid NOT NULL,
	"master_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"params" jsonb,
	"provider_job_id" uuid,
	"status" "audiokit_job_status" DEFAULT 'queued' NOT NULL,
	"result" jsonb,
	"error" jsonb,
	"authorization_id" uuid,
	"requested_by" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	CONSTRAINT "audiokit_jobs_submitted_complete" CHECK ("audiokit_jobs"."status" = 'queued' OR ("audiokit_jobs"."provider_job_id" IS NOT NULL AND "audiokit_jobs"."submitted_at" IS NOT NULL)),
	CONSTRAINT "audiokit_jobs_finished_complete" CHECK ("audiokit_jobs"."status" NOT IN ('succeeded', 'failed', 'canceled') OR "audiokit_jobs"."finished_at" IS NOT NULL),
	CONSTRAINT "audiokit_jobs_result_on_success" CHECK ("audiokit_jobs"."status" <> 'succeeded' OR "audiokit_jobs"."result" IS NOT NULL),
	CONSTRAINT "audiokit_jobs_error_on_failure" CHECK ("audiokit_jobs"."status" <> 'failed' OR "audiokit_jobs"."error" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "audiokit_jobs" ADD CONSTRAINT "audiokit_jobs_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audiokit_jobs" ADD CONSTRAINT "audiokit_jobs_recording_same_org_fk" FOREIGN KEY ("org_id","recording_id") REFERENCES "public"."recordings"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audiokit_jobs" ADD CONSTRAINT "audiokit_jobs_master_fk" FOREIGN KEY ("master_id") REFERENCES "public"."masters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audiokit_jobs" ADD CONSTRAINT "audiokit_jobs_authorization_same_org_fk" FOREIGN KEY ("org_id","authorization_id") REFERENCES "public"."authorization_decisions"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audiokit_jobs_org_recording_idx" ON "audiokit_jobs" USING btree ("org_id","recording_id","requested_at");--> statement-breakpoint
CREATE INDEX "audiokit_jobs_master_idx" ON "audiokit_jobs" USING btree ("master_id");--> statement-breakpoint
CREATE INDEX "audiokit_jobs_status_idx" ON "audiokit_jobs" USING btree ("status","requested_at");--> statement-breakpoint
CREATE INDEX "audiokit_jobs_provider_idx" ON "audiokit_jobs" USING btree ("provider_job_id");--> statement-breakpoint

-- RLS for audiokit_jobs: members read, catalog managers (catalog:write) create jobs.
-- The agent role can update job status (for the worker).
ALTER TABLE audiokit_jobs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY audiokit_jobs_member_read ON audiokit_jobs FOR SELECT USING (app.is_member(org_id));--> statement-breakpoint
CREATE POLICY audiokit_jobs_catalog_insert ON audiokit_jobs FOR INSERT TO erms_app WITH CHECK (
	app.has_role(org_id, ARRAY['owner', 'catalog_manager']) AND requested_by = app.current_user_id()::text
);--> statement-breakpoint
CREATE POLICY audiokit_jobs_agent_update ON audiokit_jobs FOR UPDATE TO erms_app USING (true) WITH CHECK (true);--> statement-breakpoint

-- The agent role can update everything except org, recording, master (immutable), and requested_by/at.
GRANT SELECT, INSERT ON audiokit_jobs TO erms_app;--> statement-breakpoint
GRANT UPDATE (operation, params, provider_job_id, status, result, error, authorization_id, submitted_at, finished_at, attempts, last_attempt_at) ON audiokit_jobs TO erms_app;