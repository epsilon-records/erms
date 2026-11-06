-- Owners and catalog managers may delete a master (EPSILON-55). 0011 deliberately left
-- masters without a DELETE policy; this adds the audited delete path. The route and
-- deleteMaster() enforce the role check too, but the database refuses anything else.
CREATE POLICY masters_catalog_delete ON masters FOR DELETE TO erms_app USING (
	app.has_role(org_id, ARRAY['owner', 'catalog_manager'])
);--> statement-breakpoint
GRANT DELETE ON masters TO erms_app;
