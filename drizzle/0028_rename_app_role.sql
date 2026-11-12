-- Rename the app role erms_app to labelkit_app (ERMS is now LabelKit; knowledge shared 0044).
--
-- Policies, grants, default privileges and memberships refer to a role by its id, not its
-- name, so they all follow the rename: nothing else changes. Checked on production on
-- 2026-11-12: no function body or policy expression names the role as text.
--
-- The app picks the role at the start of each transaction (src/lib/server/db/scoped.ts):
-- labelkit_app when it exists, erms_app otherwise. So this migration and the deploy that
-- carries that code can land in either order without a failed request.
--
-- Earlier migrations still say erms_app: they run first on a fresh database and create it.
-- Guarded, so a database that was already renamed by hand is left alone.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erms_app')
		AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'labelkit_app') THEN
		ALTER ROLE erms_app RENAME TO labelkit_app;
	END IF;
END $$;
