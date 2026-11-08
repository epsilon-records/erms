-- Owners manage their org's members (EPSILON-87). Until now erms_app could only read
-- memberships; every new person needed a hand-written database change.
--
-- What the database enforces, whatever the UI does:
--   * only an owner of an org adds, re-roles or removes members of THAT org, so an owner of
--     one label cannot place anyone in another (decision 0020) — an insert naming another org
--     is refused with 42501, not silently filtered;
--   * a member can be given owner, catalog_manager, rights_admin or viewer, never agent
--     (agent is for machine tokens);
--   * a membership cannot be moved: erms_app may update only the role column;
--   * every org keeps at least one owner, counted within that org (trigger below).
-- The app writes the audit entry in the same transaction (withAudit).

GRANT INSERT, DELETE ON memberships TO erms_app;--> statement-breakpoint
GRANT UPDATE (role) ON memberships TO erms_app;--> statement-breakpoint

CREATE POLICY memberships_owner_insert ON memberships FOR INSERT TO erms_app WITH CHECK (
	app.has_role(org_id, ARRAY['owner'])
	AND role::text = ANY (ARRAY['owner', 'catalog_manager', 'rights_admin', 'viewer'])
);--> statement-breakpoint
CREATE POLICY memberships_owner_update ON memberships FOR UPDATE TO erms_app
	USING (app.has_role(org_id, ARRAY['owner']))
	WITH CHECK (
		app.has_role(org_id, ARRAY['owner'])
		AND role::text = ANY (ARRAY['owner', 'catalog_manager', 'rights_admin', 'viewer'])
	);--> statement-breakpoint
CREATE POLICY memberships_owner_delete ON memberships FOR DELETE TO erms_app
	USING (app.has_role(org_id, ARRAY['owner']));--> statement-breakpoint

-- The last-owner rule. It holds for every connection, the owner's included, like the audit
-- log's append-only trigger: a hand-written fix must not leave a label without an owner either.
-- Deleting the org itself (memberships cascade) is the one exemption: by the time the cascade
-- reaches the memberships, the org row is gone, so there is nothing left to own.
--
-- Concurrency: the org row is locked first, so two owners demoting each other at the same
-- moment are serialised and the second one sees the first change. FOR NO KEY UPDATE does not
-- block the KEY SHARE locks that catalogue inserts take on orgs through their foreign keys.
-- SECURITY DEFINER because erms_app holds no UPDATE on orgs, which the lock needs, and the
-- count must see every owner in the org regardless of the caller's RLS view.
CREATE FUNCTION app.keep_one_owner() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
	IF OLD.role = 'owner' AND (TG_OP = 'DELETE' OR NEW.role <> 'owner') THEN
		PERFORM 1 FROM public.orgs WHERE id = OLD.org_id FOR NO KEY UPDATE;
		-- No org row: the org itself is being deleted and its memberships cascade.
		IF FOUND AND NOT EXISTS (
			SELECT 1 FROM public.memberships m
			WHERE m.org_id = OLD.org_id AND m.role = 'owner' AND m.user_id <> OLD.user_id
		) THEN
			RAISE EXCEPTION 'an org must keep at least one owner'
				USING ERRCODE = 'check_violation', CONSTRAINT = 'memberships_keep_one_owner';
		END IF;
	END IF;
	IF TG_OP = 'DELETE' THEN
		RETURN OLD;
	END IF;
	RETURN NEW;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.keep_one_owner() FROM PUBLIC;--> statement-breakpoint

CREATE TRIGGER memberships_keep_one_owner
	BEFORE UPDATE OF role OR DELETE ON memberships
	FOR EACH ROW EXECUTE FUNCTION app.keep_one_owner();
