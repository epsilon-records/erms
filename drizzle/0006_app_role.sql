-- The app no longer queries as the table owner. Each request runs in a transaction that
-- switches to erms_app and sets the signed-in user's id, so RLS checks every read and
-- write on the server too, not only on Supabase's public API.
--
-- erms_app cannot log in. The server still connects with DATABASE_URL and switches role
-- per transaction (src/lib/server/db/scoped.ts), so no new secret is needed.

DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erms_app') THEN
		CREATE ROLE erms_app NOLOGIN NOBYPASSRLS;
	END IF;
END
$$;--> statement-breakpoint
GRANT erms_app TO postgres;--> statement-breakpoint

GRANT USAGE ON SCHEMA public, app TO erms_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.current_user_id(), app.is_member(uuid), app.has_role(uuid, text[]) TO erms_app;--> statement-breakpoint
GRANT SELECT ON orgs, memberships TO erms_app;--> statement-breakpoint
GRANT SELECT, INSERT ON audit_log, import_runs TO erms_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON labels, parties, recordings, releases, release_tracks, credits TO erms_app;--> statement-breakpoint

-- release_tracks now has its own org_id (0005).
ALTER POLICY release_tracks_member_read ON release_tracks USING (app.is_member(org_id));--> statement-breakpoint

-- Write policies apply to erms_app only, so Supabase's anon and authenticated roles stay
-- read-only. Roles mirror catalog:write in src/lib/server/rbac.ts.
CREATE POLICY labels_catalog_insert ON labels FOR INSERT TO erms_app WITH CHECK (app.has_role(org_id, ARRAY['owner', 'catalog_manager']));--> statement-breakpoint
CREATE POLICY labels_catalog_update ON labels FOR UPDATE TO erms_app USING (app.has_role(org_id, ARRAY['owner', 'catalog_manager'])) WITH CHECK (app.has_role(org_id, ARRAY['owner', 'catalog_manager']));--> statement-breakpoint
CREATE POLICY labels_catalog_delete ON labels FOR DELETE TO erms_app USING (app.has_role(org_id, ARRAY['owner', 'catalog_manager']));--> statement-breakpoint

CREATE POLICY parties_catalog_insert ON parties FOR INSERT TO erms_app WITH CHECK (app.has_role(org_id, ARRAY['owner', 'catalog_manager']));--> statement-breakpoint
CREATE POLICY parties_catalog_update ON parties FOR UPDATE TO erms_app USING (app.has_role(org_id, ARRAY['owner', 'catalog_manager'])) WITH CHECK (app.has_role(org_id, ARRAY['owner', 'catalog_manager']));--> statement-breakpoint
CREATE POLICY parties_catalog_delete ON parties FOR DELETE TO erms_app USING (app.has_role(org_id, ARRAY['owner', 'catalog_manager']));--> statement-breakpoint

CREATE POLICY recordings_catalog_insert ON recordings FOR INSERT TO erms_app WITH CHECK (app.has_role(org_id, ARRAY['owner', 'catalog_manager']));--> statement-breakpoint
CREATE POLICY recordings_catalog_update ON recordings FOR UPDATE TO erms_app USING (app.has_role(org_id, ARRAY['owner', 'catalog_manager'])) WITH CHECK (app.has_role(org_id, ARRAY['owner', 'catalog_manager']));--> statement-breakpoint
CREATE POLICY recordings_catalog_delete ON recordings FOR DELETE TO erms_app USING (app.has_role(org_id, ARRAY['owner', 'catalog_manager']));--> statement-breakpoint

CREATE POLICY releases_catalog_insert ON releases FOR INSERT TO erms_app WITH CHECK (app.has_role(org_id, ARRAY['owner', 'catalog_manager']));--> statement-breakpoint
CREATE POLICY releases_catalog_update ON releases FOR UPDATE TO erms_app USING (app.has_role(org_id, ARRAY['owner', 'catalog_manager'])) WITH CHECK (app.has_role(org_id, ARRAY['owner', 'catalog_manager']));--> statement-breakpoint
CREATE POLICY releases_catalog_delete ON releases FOR DELETE TO erms_app USING (app.has_role(org_id, ARRAY['owner', 'catalog_manager']));--> statement-breakpoint

CREATE POLICY release_tracks_catalog_insert ON release_tracks FOR INSERT TO erms_app WITH CHECK (app.has_role(org_id, ARRAY['owner', 'catalog_manager']));--> statement-breakpoint
CREATE POLICY release_tracks_catalog_update ON release_tracks FOR UPDATE TO erms_app USING (app.has_role(org_id, ARRAY['owner', 'catalog_manager'])) WITH CHECK (app.has_role(org_id, ARRAY['owner', 'catalog_manager']));--> statement-breakpoint
CREATE POLICY release_tracks_catalog_delete ON release_tracks FOR DELETE TO erms_app USING (app.has_role(org_id, ARRAY['owner', 'catalog_manager']));--> statement-breakpoint

CREATE POLICY credits_catalog_insert ON credits FOR INSERT TO erms_app WITH CHECK (app.has_role(org_id, ARRAY['owner', 'catalog_manager']));--> statement-breakpoint
CREATE POLICY credits_catalog_update ON credits FOR UPDATE TO erms_app USING (app.has_role(org_id, ARRAY['owner', 'catalog_manager'])) WITH CHECK (app.has_role(org_id, ARRAY['owner', 'catalog_manager']));--> statement-breakpoint
CREATE POLICY credits_catalog_delete ON credits FOR DELETE TO erms_app USING (app.has_role(org_id, ARRAY['owner', 'catalog_manager']));--> statement-breakpoint

CREATE POLICY import_runs_catalog_insert ON import_runs FOR INSERT TO erms_app WITH CHECK (app.has_role(org_id, ARRAY['owner', 'catalog_manager']));--> statement-breakpoint

-- Any member's change is audited in that member's org, under their own id.
CREATE POLICY audit_member_insert ON audit_log FOR INSERT TO erms_app WITH CHECK (
	app.is_member(org_id) AND actor_kind = 'user' AND actor_id = app.current_user_id()::text
);
