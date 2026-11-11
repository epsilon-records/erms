ALTER TABLE "orgs" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "purge_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orgs" ADD CONSTRAINT "orgs_closed_purge_pair" CHECK (("orgs"."closed_at" IS NULL) = ("orgs"."purge_after" IS NULL));--> statement-breakpoint

-- Closing a label and purging it (privacy notice, section 6: "deleted within 30 days").
--
-- An owner closes the label with app.close_org: the label stops working for everyone and is
-- purged 30 days later, unless an owner reopens it first (app.reopen_org). The purge runs on the
-- owner connection only (app.purge_org has no grant to erms_app), from the scheduled purge job,
-- after that job has deleted the label's files in R2.

CREATE FUNCTION app.close_org(target_org uuid) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
	uid uuid := app.current_user_id();
	purge timestamptz := now() + interval '30 days';
BEGIN
	IF uid IS NULL OR NOT app.has_role(target_org, ARRAY['owner']) THEN
		RAISE EXCEPTION 'only an owner can close a label' USING ERRCODE = '42501';
	END IF;
	UPDATE orgs SET closed_at = now(), purge_after = purge
	WHERE id = target_org AND closed_at IS NULL;
	IF NOT FOUND THEN
		SELECT purge_after INTO purge FROM orgs WHERE id = target_org;
		RETURN purge;
	END IF;
	INSERT INTO audit_log (id, org_id, actor_id, actor_kind, entity, entity_id, action, after)
	VALUES (gen_random_uuid(), target_org, uid::text, 'user', 'org', target_org::text, 'close_org',
		jsonb_build_object('purge_after', purge));
	RETURN purge;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.close_org(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.close_org(uuid) TO erms_app;--> statement-breakpoint

CREATE FUNCTION app.reopen_org(target_org uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := app.current_user_id();
BEGIN
	IF uid IS NULL OR NOT app.has_role(target_org, ARRAY['owner']) THEN
		RAISE EXCEPTION 'only an owner can reopen a label' USING ERRCODE = '42501';
	END IF;
	UPDATE orgs SET closed_at = NULL, purge_after = NULL
	WHERE id = target_org AND closed_at IS NOT NULL AND purge_after > now();
	IF FOUND THEN
		INSERT INTO audit_log (id, org_id, actor_id, actor_kind, entity, entity_id, action)
		VALUES (gen_random_uuid(), target_org, uid::text, 'user', 'org', target_org::text, 'reopen_org');
	END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.reopen_org(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.reopen_org(uuid) TO erms_app;--> statement-breakpoint

-- The audit log stays append-only, with one exception: app.purge_org deletes a purged label's
-- entries, inside its own transaction, after setting app.purge_org to that label's id. erms_app
-- holds no DELETE on audit_log, so only the owner connection can reach this path.
CREATE OR REPLACE FUNCTION app.reject_audit_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'DELETE' AND OLD.org_id::text = current_setting('app.purge_org', true) THEN
		RETURN OLD;
	END IF;
	RAISE EXCEPTION 'audit_log is append-only';
END
$$;--> statement-breakpoint

CREATE FUNCTION app.purge_org(target_org uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
	-- Lock the org and re-check, so a reopen that raced the job wins.
	PERFORM 1 FROM orgs WHERE id = target_org AND closed_at IS NOT NULL AND purge_after <= now() FOR UPDATE;
	IF NOT FOUND THEN
		RETURN false;
	END IF;
	PERFORM set_config('app.purge_org', target_org::text, true);
	DELETE FROM webhook_events WHERE job_id IN (SELECT id FROM audiokit_jobs WHERE org_id = target_org);
	DELETE FROM audiokit_jobs WHERE org_id = target_org;
	DELETE FROM audiokit_label_clients WHERE org_id = target_org;
	DELETE FROM authorization_decisions WHERE org_id = target_org;
	DELETE FROM consents WHERE org_id = target_org;
	DELETE FROM rights_shares WHERE org_id = target_org;
	DELETE FROM agreements WHERE org_id = target_org;
	DELETE FROM composition_writers WHERE org_id = target_org;
	DELETE FROM recording_compositions WHERE org_id = target_org;
	DELETE FROM compositions WHERE org_id = target_org;
	DELETE FROM credits WHERE org_id = target_org;
	DELETE FROM release_tracks WHERE org_id = target_org;
	DELETE FROM masters WHERE org_id = target_org;
	DELETE FROM releases WHERE org_id = target_org;
	DELETE FROM recordings WHERE org_id = target_org;
	DELETE FROM parties WHERE org_id = target_org;
	DELETE FROM labels WHERE org_id = target_org;
	DELETE FROM import_runs WHERE org_id = target_org;
	DELETE FROM audit_log WHERE org_id = target_org;
	-- Memberships and API keys cascade. The last-owner rule exempts a deleted org.
	DELETE FROM orgs WHERE id = target_org;
	PERFORM set_config('app.purge_org', '', true);
	RETURN true;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.purge_org(uuid) FROM PUBLIC;
