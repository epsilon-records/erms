-- A user may only update a job in an org where they have catalog scope. Machine
-- writes (webhook, worker, reconcile) use the owner connection and bypass RLS, so
-- this only narrows what an app-connected member can do (EPSILON-70).
DROP POLICY IF EXISTS audiokit_jobs_agent_update ON audiokit_jobs;--> statement-breakpoint
CREATE POLICY audiokit_jobs_agent_update ON audiokit_jobs FOR UPDATE TO erms_app
	USING (app.has_role(org_id, ARRAY['owner', 'catalog_manager']))
	WITH CHECK (app.has_role(org_id, ARRAY['owner', 'catalog_manager']));
