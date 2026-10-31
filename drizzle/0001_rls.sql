-- Row-level security: the second enforcement layer behind the API.
-- The server connects as the table owner (bypasses RLS); client-side access through
-- Supabase's anon/authenticated roles is limited to the caller's own orgs.
--
-- app.current_user_id() reads the JWT subject the same way Supabase's auth.uid() does,
-- so these policies also run on a plain local Postgres.

CREATE SCHEMA IF NOT EXISTS app;--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
	SELECT nullif(
		coalesce(
			nullif(current_setting('request.jwt.claim.sub', true), ''),
			nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
		),
		''
	)::uuid
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.is_member(target_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
	SELECT EXISTS (
		SELECT 1 FROM memberships m
		WHERE m.org_id = target_org AND m.user_id = app.current_user_id()
	)
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION app.has_role(target_org uuid, roles text[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
	SELECT EXISTS (
		SELECT 1 FROM memberships m
		WHERE m.org_id = target_org
			AND m.user_id = app.current_user_id()
			AND m.role::text = ANY (roles)
	)
$$;--> statement-breakpoint

ALTER TABLE orgs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY orgs_member_read ON orgs FOR SELECT USING (app.is_member(id));--> statement-breakpoint
CREATE POLICY memberships_member_read ON memberships FOR SELECT USING (app.is_member(org_id));--> statement-breakpoint
CREATE POLICY audit_owner_read ON audit_log FOR SELECT USING (app.has_role(org_id, ARRAY['owner']));--> statement-breakpoint

-- Pattern for every later org-scoped table:
--   ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
--   CREATE POLICY <t>_member_read ON <t> FOR SELECT USING (app.is_member(org_id));
-- Writes go through the API only, so no INSERT/UPDATE/DELETE policies are granted.

-- The audit log is append-only, even for the table owner.
CREATE OR REPLACE FUNCTION app.reject_audit_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'audit_log is append-only';
END
$$;--> statement-breakpoint

CREATE TRIGGER audit_log_append_only
	BEFORE UPDATE OR DELETE ON audit_log
	FOR EACH ROW EXECUTE FUNCTION app.reject_audit_change();
