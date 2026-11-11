-- A job that never reached AudioKit (its label has no client, EPSILON-135) can now fail terminally
-- after its retries; before, the max_attempts update broke this check and aborted the worker run.
ALTER TABLE "audiokit_jobs" DROP CONSTRAINT "audiokit_jobs_submitted_complete";--> statement-breakpoint
ALTER TABLE "audiokit_jobs" ADD CONSTRAINT "audiokit_jobs_submitted_complete" CHECK ("audiokit_jobs"."status" IN ('queued', 'failed') OR ("audiokit_jobs"."provider_job_id" IS NOT NULL AND "audiokit_jobs"."submitted_at" IS NOT NULL));