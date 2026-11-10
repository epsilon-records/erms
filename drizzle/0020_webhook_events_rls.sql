-- webhook_events (0013) was created without row-level security, and Supabase's default
-- privileges left anon and authenticated holding every table privilege on it, so the public
-- PostgREST API could read and write it. Only the AudioKit webhook route touches the table, and
-- it uses the owner connection (which bypasses RLS), so no role needs a policy here.
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- RLS does not govern TRUNCATE, REFERENCES or TRIGGER, so take the privileges away as well.
REVOKE ALL ON TABLE webhook_events FROM PUBLIC, anon, authenticated, erms_app;
