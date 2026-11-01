-- RLS for the Phase 1 catalog tables, following the pattern in 0001_rls.sql.
-- Members of an org can read its catalog; writes go through the API only.
ALTER TABLE labels ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE parties ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE recordings ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE releases ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE release_tracks ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE credits ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE import_runs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY labels_member_read ON labels FOR SELECT USING (app.is_member(org_id));--> statement-breakpoint
CREATE POLICY parties_member_read ON parties FOR SELECT USING (app.is_member(org_id));--> statement-breakpoint
CREATE POLICY recordings_member_read ON recordings FOR SELECT USING (app.is_member(org_id));--> statement-breakpoint
CREATE POLICY releases_member_read ON releases FOR SELECT USING (app.is_member(org_id));--> statement-breakpoint
CREATE POLICY release_tracks_member_read ON release_tracks FOR SELECT USING (
	EXISTS (SELECT 1 FROM releases r WHERE r.id = release_id AND app.is_member(r.org_id))
);--> statement-breakpoint
CREATE POLICY credits_member_read ON credits FOR SELECT USING (app.is_member(org_id));--> statement-breakpoint
CREATE POLICY import_runs_member_read ON import_runs FOR SELECT USING (app.is_member(org_id));
