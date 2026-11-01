CREATE INDEX "credits_org_recording_idx" ON "credits" USING btree ("org_id","recording_id");--> statement-breakpoint
CREATE INDEX "credits_org_release_idx" ON "credits" USING btree ("org_id","release_id");--> statement-breakpoint
CREATE INDEX "import_runs_org_created_idx" ON "import_runs" USING btree ("org_id","created_at");--> statement-breakpoint
ALTER TABLE "credits" ADD CONSTRAINT "credits_position_nonnegative" CHECK ("credits"."position" >= 0);--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_sha256_format" CHECK ("import_runs"."file_sha256" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_isrc_format" CHECK ("recordings"."isrc" ~ '^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$');--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_duration_positive" CHECK ("recordings"."duration_ms" IS NULL OR "recordings"."duration_ms" > 0);--> statement-breakpoint
ALTER TABLE "release_tracks" ADD CONSTRAINT "release_tracks_position_positive" CHECK ("release_tracks"."position" > 0 AND "release_tracks"."disc" > 0);--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_upc_format" CHECK ("releases"."upc" ~ '^[0-9]{12,13}$');