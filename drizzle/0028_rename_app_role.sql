-- Rename the database roles from erms_* to labelkit_* (ERMS is now LabelKit; knowledge shared 0044):
--   erms_app -> labelkit_app, erms_auth_email -> labelkit_auth_email,
--   erms_metrics_ingest -> labelkit_metrics_ingest, erms_metrics_prune -> labelkit_metrics_prune.
--
-- Policies, grants, default privileges and memberships refer to a role by its id, not its
-- name, so a rename carries them all. Checked on production on 2026-11-12: no function body,
-- policy expression or default privilege names any of them as text.
--
-- The app picks each role when it switches to it (src/lib/server/db/scoped.ts): the
-- labelkit_* name when it exists, the erms_* name otherwise. So this migration and the deploy that
-- carries that code can land in either order without a failed request.
--
-- Roles belong to the whole cluster, databases do not. On a cluster with more than one
-- database (the test suite's template, a developer's machine) the first database migrated
-- renames a role; a database migrated after that runs the migration that created it, finds no
-- erms_* role, creates a new one and grants it everything. For that case this migration moves
-- this database's grants and policies to the labelkit_* role and then drops the erms_* one if
-- nothing else uses it.
--
-- Earlier migrations still say erms_*: they run first on a fresh database and create the roles.
DO $$
DECLARE
	pair text[];
	old_name text;
	new_name text;
	old_oid oid;
	r record;
BEGIN
	FOREACH pair SLICE 1 IN ARRAY ARRAY[
		ARRAY['erms_app', 'labelkit_app'],
		ARRAY['erms_auth_email', 'labelkit_auth_email'],
		ARRAY['erms_metrics_ingest', 'labelkit_metrics_ingest'],
		ARRAY['erms_metrics_prune', 'labelkit_metrics_prune']
	] LOOP
		old_name := pair[1];
		new_name := pair[2];
		SELECT oid INTO old_oid FROM pg_roles WHERE rolname = old_name;
		CONTINUE WHEN old_oid IS NULL; -- already renamed, or never created

		IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = new_name) THEN
			EXECUTE format('ALTER ROLE %I RENAME TO %I', old_name, new_name);
			CONTINUE;
		END IF;

		-- Both exist: move what this database grants the old role to the new one.
		EXECUTE format('GRANT %I TO postgres', new_name);

		FOR r IN
			SELECT n.nspname, a.privilege_type, a.is_grantable
			FROM pg_namespace n, aclexplode(n.nspacl) a
			WHERE a.grantee = old_oid
		LOOP
			EXECUTE format('GRANT %s ON SCHEMA %I TO %I%s', r.privilege_type, r.nspname, new_name,
				CASE WHEN r.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
		END LOOP;

		FOR r IN
			SELECT c.oid::regclass AS rel, c.relkind, a.privilege_type, a.is_grantable
			FROM pg_class c, aclexplode(c.relacl) a
			WHERE a.grantee = old_oid
		LOOP
			EXECUTE format('GRANT %s ON %s %s TO %I%s', r.privilege_type,
				CASE WHEN r.relkind = 'S' THEN 'SEQUENCE' ELSE 'TABLE' END, r.rel, new_name,
				CASE WHEN r.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
		END LOOP;

		FOR r IN
			SELECT at.attrelid::regclass AS rel, at.attname, a.privilege_type, a.is_grantable
			FROM pg_attribute at, aclexplode(at.attacl) a
			WHERE a.grantee = old_oid AND NOT at.attisdropped
		LOOP
			EXECUTE format('GRANT %s (%I) ON TABLE %s TO %I%s', r.privilege_type, r.attname, r.rel,
				new_name, CASE WHEN r.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
		END LOOP;

		FOR r IN
			SELECT p.oid::regprocedure AS fn, a.privilege_type, a.is_grantable
			FROM pg_proc p, aclexplode(p.proacl) a
			WHERE a.grantee = old_oid
		LOOP
			EXECUTE format('GRANT %s ON FUNCTION %s TO %I%s', r.privilege_type, r.fn, new_name,
				CASE WHEN r.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
		END LOOP;

		FOR r IN
			SELECT pol.polname, pol.polrelid::regclass AS rel,
				(SELECT string_agg(CASE WHEN x = old_oid THEN quote_ident(new_name)
					WHEN x = 0 THEN 'PUBLIC' ELSE quote_ident(x::regrole::text) END, ', ')
				 FROM unnest(pol.polroles) x) AS roles
			FROM pg_policy pol
			WHERE old_oid = ANY (pol.polroles)
		LOOP
			EXECUTE format('ALTER POLICY %I ON %s TO %s', r.polname, r.rel, r.roles);
		END LOOP;

		-- Nothing in this database refers to the old role any more.
		EXECUTE format('DROP OWNED BY %I', old_name);
		BEGIN
			EXECUTE format('DROP ROLE %I', old_name);
		EXCEPTION WHEN dependent_objects_still_exist THEN
			-- Another database on this cluster still grants it something; leave the role.
			RAISE NOTICE '% is still used by another database; not dropped', old_name;
		END;
	END LOOP;
END $$;
