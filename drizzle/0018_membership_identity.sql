-- Preserve 0017: its production deployment status was not established during review.
-- Membership identity is immutable for every connection, including the owner connection.
-- This closes org_id moves that bypassed the last-owner guard. No application path changes
-- membership identity; replacing a membership requires a guarded delete and a new insert.
--
-- Lock order for a single-member change: membership row (by UPDATE/DELETE, or the app's
-- audit SELECT FOR UPDATE), then org row below. The count is an MVCC read, taking no
-- membership row locks. Under READ COMMITTED, the query after the org lock sees the prior
-- transaction's committed change. This does not claim repeatable-read serializability.
-- FOR NO KEY UPDATE remains compatible with foreign-key KEY SHARE locks on the org.
CREATE OR REPLACE FUNCTION app.keep_one_owner() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
	IF TG_OP = 'UPDATE' AND (
		NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.user_id IS DISTINCT FROM OLD.user_id
	) THEN
		RAISE EXCEPTION 'membership identity is immutable'
			USING ERRCODE = 'check_violation', CONSTRAINT = 'memberships_identity_immutable';
	END IF;
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

DROP TRIGGER memberships_keep_one_owner ON memberships;--> statement-breakpoint

CREATE TRIGGER memberships_keep_one_owner
	BEFORE UPDATE OF role, org_id, user_id OR DELETE ON memberships
	FOR EACH ROW EXECUTE FUNCTION app.keep_one_owner();
