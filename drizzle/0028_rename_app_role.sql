-- Rename the app role erms_app to labelkit_app (ERMS is now LabelKit; knowledge shared 0044).
--
-- Policies, grants, default privileges and memberships refer to a role by its id, not its
-- name, so a rename carries them all. Checked on production on 2026-11-12: no function body or
-- policy expression names the role as text.
--
-- The app picks the role at the start of each transaction (src/lib/server/db/scoped.ts):
-- labelkit_app when it exists, erms_app otherwise. So this migration and the deploy that
-- carries that code can land in either order without a failed request.
--
-- Roles belong to the whole cluster, databases do not. On a cluster with more than one
-- database (the test suite's template, a developer's machine) the first database migrated
-- renames the role; a database migrated after that runs 0006, finds no erms_app, creates a new
-- one and grants it everything. For that case this migration moves this database's grants and
-- policies from erms_app to labelkit_app and then drops erms_app if nothing else uses it.
--
-- Earlier migrations still say erms_app: they run first on a fresh database and create it.
DO $$
DECLARE
	old_oid oid;
	r record;
BEGIN
	SELECT oid INTO old_oid FROM pg_roles WHERE rolname = 'erms_app';
	IF old_oid IS NULL THEN
		RETURN; -- already renamed, or never created
	END IF;

	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'labelkit_app') THEN
		ALTER ROLE erms_app RENAME TO labelkit_app;
		RETURN;
	END IF;

	-- Both exist: move what this database grants erms_app to labelkit_app.
	GRANT labelkit_app TO postgres;

	FOR r IN
		SELECT n.nspname, a.privilege_type, a.is_grantable
		FROM pg_namespace n, aclexplode(n.nspacl) a
		WHERE a.grantee = old_oid
	LOOP
		EXECUTE format('GRANT %s ON SCHEMA %I TO labelkit_app%s', r.privilege_type, r.nspname,
			CASE WHEN r.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
	END LOOP;

	FOR r IN
		SELECT c.oid::regclass AS rel, c.relkind, a.privilege_type, a.is_grantable
		FROM pg_class c, aclexplode(c.relacl) a
		WHERE a.grantee = old_oid
	LOOP
		EXECUTE format('GRANT %s ON %s %s TO labelkit_app%s', r.privilege_type,
			CASE WHEN r.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END, r.rel,
			CASE WHEN r.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
	END LOOP;

	FOR r IN
		SELECT at.attrelid::regclass AS rel, at.attname, a.privilege_type, a.is_grantable
		FROM pg_attribute at, aclexplode(at.attacl) a
		WHERE a.grantee = old_oid AND NOT at.attisdropped
	LOOP
		EXECUTE format('GRANT %s (%I) ON TABLE %s TO labelkit_app%s', r.privilege_type, r.attname,
			r.rel, CASE WHEN r.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
	END LOOP;

	FOR r IN
		SELECT p.oid::regprocedure AS fn, a.privilege_type, a.is_grantable
		FROM pg_proc p, aclexplode(p.proacl) a
		WHERE a.grantee = old_oid
	LOOP
		EXECUTE format('GRANT %s ON FUNCTION %s TO labelkit_app%s', r.privilege_type, r.fn,
			CASE WHEN r.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
	END LOOP;

	FOR r IN
		SELECT pol.polname, pol.polrelid::regclass AS rel,
			(SELECT string_agg(CASE WHEN x = old_oid THEN 'labelkit_app'
				WHEN x = 0 THEN 'PUBLIC' ELSE quote_ident(x::regrole::text) END, ', ')
			 FROM unnest(pol.polroles) x) AS roles
		FROM pg_policy pol
		WHERE old_oid = ANY (pol.polroles)
	LOOP
		EXECUTE format('ALTER POLICY %I ON %s TO %s', r.polname, r.rel, r.roles);
	END LOOP;

	-- Nothing in this database refers to erms_app any more.
	DROP OWNED BY erms_app;
	BEGIN
		DROP ROLE erms_app;
	EXCEPTION WHEN dependent_objects_still_exist THEN
		-- Another database on this cluster still grants it something; leave the role.
		RAISE NOTICE 'erms_app is still used by another database; not dropped';
	END;
END $$;
