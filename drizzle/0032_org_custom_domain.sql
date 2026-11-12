ALTER TABLE "orgs" ADD COLUMN "domain_requested" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "domain_token" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "domain_status" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "domain_error" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "domain_retired" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "domain_provisioning" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orgs" ADD CONSTRAINT "orgs_domain_requested_format" CHECK ("orgs"."domain_requested" IS NULL OR "orgs"."domain_requested" ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$');--> statement-breakpoint
ALTER TABLE "orgs" ADD CONSTRAINT "orgs_domain_status_value" CHECK ("orgs"."domain_status" IS NULL OR "orgs"."domain_status" IN ('awaiting_dns', 'active', 'failed'));--> statement-breakpoint
-- Self-serve custom domains (knowledge labelkit 0034, 0036): any label's owners set the domain the
-- label is served on, on /org/branding. A domain is claimed in two steps. app.request_org_domain
-- records the request and a token; the owner publishes it as a TXT record at
-- _labelkit-verify.<domain>. Once the app has read that record and provisioned the domain (Netlify
-- alias and TLS, Supabase Auth redirect), app.activate_org_domain makes it the label's
-- custom_domain. labelkit_app keeps SELECT-only on orgs, so these SECURITY DEFINER functions are
-- the write path; each checks the owner role and writes the audit log.
--
-- A domain the label stops using goes on domain_retired until the app has taken it off Netlify
-- and Supabase Auth, so a failed or skipped cleanup is retried rather than forgotten. That covers
-- an active domain that is removed or replaced by a move, and a pending one that is cancelled,
-- removed or replaced by another request once its provisioning has begun (domain_provisioning):
-- verification may have provisioned part of it before failing or being overtaken. A pending
-- domain whose TXT record was never verified is not retired, because LabelKit never touched it
-- on Netlify or Supabase, and an owner must not be able to have an alias someone else configured
-- removed just by requesting its name. Activation takes the domain back off the list.
-- app.clear_retired_domain takes a domain off the list once its cleanup has worked.

-- Labels that already have a domain (set by hand before this migration) are active.
UPDATE orgs SET domain_status = 'active' WHERE custom_domain IS NOT NULL;--> statement-breakpoint

CREATE FUNCTION app.request_org_domain(target_org uuid, new_domain text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
	uid uuid := app.current_user_id();
	token text := replace(gen_random_uuid()::text, '-', '');
BEGIN
	IF uid IS NULL OR NOT app.has_role(target_org, ARRAY['owner']) THEN
		RAISE EXCEPTION 'only an owner can set the domain' USING ERRCODE = '42501';
	END IF;
	IF EXISTS (SELECT 1 FROM public.orgs WHERE custom_domain = new_domain AND id <> target_org) THEN
		RAISE EXCEPTION 'that domain belongs to another label' USING ERRCODE = '23505';
	END IF;
	UPDATE public.orgs
	SET domain_requested = new_domain, domain_token = token, domain_status = 'awaiting_dns',
		domain_error = NULL,
		domain_retired = CASE
			WHEN domain_provisioning AND domain_requested <> new_domain
				THEN array_append(array_remove(domain_retired, domain_requested), domain_requested)
			ELSE domain_retired
		END,
		domain_provisioning = domain_provisioning AND domain_requested = new_domain
	WHERE id = target_org;
	INSERT INTO public.audit_log (id, org_id, actor_id, actor_kind, entity, entity_id, action, after)
	VALUES (gen_random_uuid(), target_org, uid::text, 'user', 'org', target_org::text,
		'request_domain', jsonb_build_object('domain', new_domain));
	RETURN token;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.request_org_domain(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.request_org_domain(uuid, text) TO labelkit_app;--> statement-breakpoint

-- Called by the app only after it has read the TXT record and provisioned the domain.
CREATE FUNCTION app.activate_org_domain(target_org uuid, verified_domain text, verified_token text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
	uid uuid := app.current_user_id();
	prev text;
BEGIN
	IF uid IS NULL OR NOT app.has_role(target_org, ARRAY['owner']) THEN
		RAISE EXCEPTION 'only an owner can set the domain' USING ERRCODE = '42501';
	END IF;
	SELECT custom_domain INTO prev FROM public.orgs
	WHERE id = target_org AND domain_requested = verified_domain AND domain_token = verified_token
	FOR UPDATE;
	IF NOT FOUND THEN
		RAISE EXCEPTION 'no pending request for that domain' USING ERRCODE = '22023';
	END IF;
	IF EXISTS (SELECT 1 FROM public.orgs WHERE custom_domain = verified_domain AND id <> target_org) THEN
		RAISE EXCEPTION 'that domain belongs to another label' USING ERRCODE = '23505';
	END IF;
	UPDATE public.orgs
	SET custom_domain = verified_domain, domain_requested = NULL, domain_token = NULL,
		domain_status = 'active', domain_error = NULL, domain_provisioning = false,
		-- The domain it replaces still needs cleaning up; the one it activates no longer does.
		domain_retired = CASE
			WHEN prev IS NOT NULL AND prev <> verified_domain
				THEN array_append(array_remove(domain_retired, prev), prev)
			ELSE domain_retired
		END
	WHERE id = target_org;
	UPDATE public.orgs SET domain_retired = array_remove(domain_retired, verified_domain)
	WHERE id = target_org;
	INSERT INTO public.audit_log (id, org_id, actor_id, actor_kind, entity, entity_id, action, before, after)
	VALUES (gen_random_uuid(), target_org, uid::text, 'user', 'org', target_org::text,
		'activate_domain', jsonb_build_object('domain', prev),
		jsonb_build_object('domain', verified_domain));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.activate_org_domain(uuid, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.activate_org_domain(uuid, text, text) TO labelkit_app;--> statement-breakpoint

-- Records why a verification or provisioning attempt failed, for the settings page.
CREATE FUNCTION app.fail_org_domain(target_org uuid, failed_domain text, reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
	IF app.current_user_id() IS NULL OR NOT app.has_role(target_org, ARRAY['owner']) THEN
		RAISE EXCEPTION 'only an owner can set the domain' USING ERRCODE = '42501';
	END IF;
	UPDATE public.orgs SET domain_status = 'failed', domain_error = left(reason, 300)
	WHERE id = target_org AND domain_requested = failed_domain;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.fail_org_domain(uuid, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.fail_org_domain(uuid, text, text) TO labelkit_app;--> statement-breakpoint

-- Removes the label's domain and any pending request. The domain that was active goes on
-- domain_retired, for the app to take off Netlify and Supabase Auth.
CREATE FUNCTION app.remove_org_domain(target_org uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
	uid uuid := app.current_user_id();
	prev text;
	pending text;
BEGIN
	IF uid IS NULL OR NOT app.has_role(target_org, ARRAY['owner']) THEN
		RAISE EXCEPTION 'only an owner can set the domain' USING ERRCODE = '42501';
	END IF;
	SELECT custom_domain, CASE WHEN domain_provisioning THEN domain_requested END
	INTO prev, pending FROM public.orgs WHERE id = target_org FOR UPDATE;
	UPDATE public.orgs
	SET custom_domain = NULL, domain_requested = NULL, domain_token = NULL, domain_status = NULL,
		domain_error = NULL, domain_provisioning = false,
		domain_retired = (
			SELECT coalesce(array_agg(DISTINCT d), '{}')
			FROM unnest(domain_retired || ARRAY[prev, pending]) AS d
			WHERE d IS NOT NULL
		)
	WHERE id = target_org;
	IF prev IS NOT NULL OR pending IS NOT NULL THEN
		INSERT INTO public.audit_log (id, org_id, actor_id, actor_kind, entity, entity_id, action, before)
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
	uid uuid := app.current_user_id();
	pending text;
	provisioning boolean;
BEGIN
	IF uid IS NULL OR NOT app.has_role(target_org, ARRAY['owner']) THEN
		RAISE EXCEPTION 'only an owner can set the domain' USING ERRCODE = '42501';
	END IF;
	SELECT domain_requested, domain_provisioning INTO pending, provisioning
	FROM public.orgs WHERE id = target_org FOR UPDATE;
	UPDATE public.orgs
	SET domain_requested = NULL, domain_token = NULL, domain_error = NULL,
		domain_status = CASE WHEN custom_domain IS NULL THEN NULL ELSE 'active' END,
		domain_provisioning = false,
		domain_retired = CASE
			WHEN provisioning AND pending IS DISTINCT FROM custom_domain
				THEN array_append(array_remove(domain_retired, pending), pending)
			ELSE domain_retired
		END
	WHERE id = target_org;
	IF pending IS NOT NULL THEN
		INSERT INTO public.audit_log (id, org_id, actor_id, actor_kind, entity, entity_id, action, before)
		VALUES (gen_random_uuid(), target_org, uid::text, 'user', 'org', target_org::text,
			'cancel_domain_request', jsonb_build_object('requested', pending));
	END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.cancel_org_domain_request(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.cancel_org_domain_request(uuid) TO labelkit_app;;--> statement-breakpoint

-- Marks the pending request as being provisioned. The app calls it only after the TXT record has
-- proved control of the domain, once on its own (so the mark survives a crash during provisioning)
-- and again under the provisioning lock right before it touches Netlify and Supabase: that second
-- call also re-checks the request still carries the verified token and locks the row, so a cancel
-- either retires the domain first, and provisioning is skipped, or waits for it to finish.
CREATE FUNCTION app.begin_domain_provisioning(target_org uuid, verified_domain text, verified_token text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
	IF app.current_user_id() IS NULL OR NOT app.has_role(target_org, ARRAY['owner']) THEN
		RAISE EXCEPTION 'only an owner can set the domain' USING ERRCODE = '42501';
	END IF;
	UPDATE public.orgs SET domain_provisioning = true
	WHERE id = target_org AND domain_requested = verified_domain AND domain_token = verified_token;
	IF NOT FOUND THEN
		RAISE EXCEPTION 'no pending request for that domain' USING ERRCODE = '22023';
	END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.begin_domain_provisioning(uuid, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.begin_domain_provisioning(uuid, text, text) TO labelkit_app;--> statement-breakpoint

-- The label's retired domains, each with whether any label (this one included) serves it now.
-- One in use must stay on Netlify and Supabase Auth; the app only takes it off the list.
CREATE FUNCTION app.retired_org_domains(target_org uuid)
RETURNS TABLE (domain text, in_use boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
	IF app.current_user_id() IS NULL OR NOT app.has_role(target_org, ARRAY['owner']) THEN
		RAISE EXCEPTION 'only an owner can set the domain' USING ERRCODE = '42501';
	END IF;
	RETURN QUERY
	SELECT r.d, EXISTS (SELECT 1 FROM public.orgs o WHERE o.custom_domain = r.d)
	FROM public.orgs, unnest(orgs.domain_retired) AS r(d)
	WHERE orgs.id = target_org;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.retired_org_domains(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.retired_org_domains(uuid) TO labelkit_app;--> statement-breakpoint

-- Called by the app once a retired domain is off Netlify and Supabase Auth (or is in use again).
CREATE FUNCTION app.clear_retired_domain(target_org uuid, done_domain text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
	IF app.current_user_id() IS NULL OR NOT app.has_role(target_org, ARRAY['owner']) THEN
		RAISE EXCEPTION 'only an owner can set the domain' USING ERRCODE = '42501';
	END IF;
	UPDATE public.orgs SET domain_retired = array_remove(domain_retired, done_domain)
	WHERE id = target_org;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.clear_retired_domain(uuid, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.clear_retired_domain(uuid, text) TO labelkit_app;
