ALTER TABLE "orgs" ADD COLUMN "domain_requested" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "domain_token" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "domain_status" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "domain_error" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD CONSTRAINT "orgs_domain_requested_format" CHECK ("orgs"."domain_requested" IS NULL OR "orgs"."domain_requested" ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$');--> statement-breakpoint
ALTER TABLE "orgs" ADD CONSTRAINT "orgs_domain_status_value" CHECK ("orgs"."domain_status" IS NULL OR "orgs"."domain_status" IN ('awaiting_dns', 'active', 'failed'));--> statement-breakpoint
-- Self-serve custom domains (knowledge labelkit 0034, 0036): any label's owners set the domain the
-- label is served on, on /org/branding. A domain is claimed in two steps. app.request_org_domain
-- records the request and a token; the owner publishes it as a TXT record at
-- _labelkit-verify.<domain>. Once the app has read that record and provisioned the domain (Netlify
-- alias and TLS, Supabase Auth redirect), app.activate_org_domain makes it the label's
-- custom_domain. labelkit_app keeps SELECT-only on orgs, so these SECURITY DEFINER functions are
-- the write path; each checks the owner role and writes the audit log.

-- Labels that already have a domain (set by hand before this migration) are active.
UPDATE orgs SET domain_status = 'active' WHERE custom_domain IS NOT NULL;--> statement-breakpoint

CREATE FUNCTION app.request_org_domain(target_org uuid, new_domain text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
	uid uuid := app.current_user_id();
	token text := replace(gen_random_uuid()::text, '-', '');
BEGIN
	IF uid IS NULL OR NOT app.has_role(target_org, ARRAY['owner']) THEN
		RAISE EXCEPTION 'only an owner can set the domain' USING ERRCODE = '42501';
	END IF;
	IF EXISTS (SELECT 1 FROM orgs WHERE custom_domain = new_domain AND id <> target_org) THEN
		RAISE EXCEPTION 'that domain belongs to another label' USING ERRCODE = '23505';
	END IF;
	UPDATE orgs
	SET domain_requested = new_domain, domain_token = token, domain_status = 'awaiting_dns',
		domain_error = NULL
	WHERE id = target_org;
	INSERT INTO audit_log (id, org_id, actor_id, actor_kind, entity, entity_id, action, after)
	VALUES (gen_random_uuid(), target_org, uid::text, 'user', 'org', target_org::text,
		'request_domain', jsonb_build_object('domain', new_domain));
	RETURN token;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.request_org_domain(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.request_org_domain(uuid, text) TO labelkit_app;--> statement-breakpoint

-- Called by the app only after it has read the TXT record and provisioned the domain.
CREATE FUNCTION app.activate_org_domain(target_org uuid, verified_domain text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
	uid uuid := app.current_user_id();
	prev text;
BEGIN
	IF uid IS NULL OR NOT app.has_role(target_org, ARRAY['owner']) THEN
		RAISE EXCEPTION 'only an owner can set the domain' USING ERRCODE = '42501';
	END IF;
	SELECT custom_domain INTO prev FROM orgs
	WHERE id = target_org AND domain_requested = verified_domain FOR UPDATE;
	IF NOT FOUND THEN
		RAISE EXCEPTION 'no pending request for that domain' USING ERRCODE = '22023';
	END IF;
	IF EXISTS (SELECT 1 FROM orgs WHERE custom_domain = verified_domain AND id <> target_org) THEN
		RAISE EXCEPTION 'that domain belongs to another label' USING ERRCODE = '23505';
	END IF;
	UPDATE orgs
	SET custom_domain = verified_domain, domain_requested = NULL, domain_token = NULL,
		domain_status = 'active', domain_error = NULL
	WHERE id = target_org;
	INSERT INTO audit_log (id, org_id, actor_id, actor_kind, entity, entity_id, action, before, after)
	VALUES (gen_random_uuid(), target_org, uid::text, 'user', 'org', target_org::text,
		'activate_domain', jsonb_build_object('domain', prev),
		jsonb_build_object('domain', verified_domain));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.activate_org_domain(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.activate_org_domain(uuid, text) TO labelkit_app;--> statement-breakpoint

-- Records why a verification or provisioning attempt failed, for the settings page.
CREATE FUNCTION app.fail_org_domain(target_org uuid, failed_domain text, reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
	IF app.current_user_id() IS NULL OR NOT app.has_role(target_org, ARRAY['owner']) THEN
		RAISE EXCEPTION 'only an owner can set the domain' USING ERRCODE = '42501';
	END IF;
	UPDATE orgs SET domain_status = 'failed', domain_error = left(reason, 300)
	WHERE id = target_org AND domain_requested = failed_domain;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.fail_org_domain(uuid, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.fail_org_domain(uuid, text, text) TO labelkit_app;--> statement-breakpoint

-- Removes the label's domain and any pending request. Returns the domain that was active, so the
-- app can take it off Netlify and Supabase Auth.
CREATE FUNCTION app.remove_org_domain(target_org uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
	uid uuid := app.current_user_id();
	prev text;
	pending text;
BEGIN
	IF uid IS NULL OR NOT app.has_role(target_org, ARRAY['owner']) THEN
		RAISE EXCEPTION 'only an owner can set the domain' USING ERRCODE = '42501';
	END IF;
	SELECT custom_domain, domain_requested INTO prev, pending FROM orgs WHERE id = target_org FOR UPDATE;
	UPDATE orgs
	SET custom_domain = NULL, domain_requested = NULL, domain_token = NULL, domain_status = NULL,
		domain_error = NULL
	WHERE id = target_org;
	IF prev IS NOT NULL OR pending IS NOT NULL THEN
		INSERT INTO audit_log (id, org_id, actor_id, actor_kind, entity, entity_id, action, before)
		VALUES (gen_random_uuid(), target_org, uid::text, 'user', 'org', target_org::text,
			'remove_domain', jsonb_build_object('domain', prev, 'requested', pending));
	END IF;
	RETURN prev;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.remove_org_domain(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.remove_org_domain(uuid) TO labelkit_app;--> statement-breakpoint

-- Drops a pending request only; an active domain stays as it is.
CREATE FUNCTION app.cancel_org_domain_request(target_org uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
	IF app.current_user_id() IS NULL OR NOT app.has_role(target_org, ARRAY['owner']) THEN
		RAISE EXCEPTION 'only an owner can set the domain' USING ERRCODE = '42501';
	END IF;
	UPDATE orgs
	SET domain_requested = NULL, domain_token = NULL, domain_error = NULL,
		domain_status = CASE WHEN custom_domain IS NULL THEN NULL ELSE 'active' END
	WHERE id = target_org;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.cancel_org_domain_request(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.cancel_org_domain_request(uuid) TO labelkit_app;
