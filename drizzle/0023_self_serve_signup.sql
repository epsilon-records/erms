-- Self-serve signup (EPSILON-130). erms_app holds no INSERT on orgs, and only an owner may insert
-- memberships, so a signed-in user with no label had no way to create one. This SECURITY DEFINER
-- function is that one way: it creates the org, makes the caller its owner and writes the audit
-- entry, all in the caller's transaction. The caller is always app.current_user_id(), never an
-- argument. Whether signup is open at all is the app's switch (SIGNUP_ENABLED); this function only
-- guards the data.
CREATE FUNCTION app.create_org(new_org uuid, org_name text, org_slug text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
	uid uuid := app.current_user_id();
	clean_name text := btrim(org_name);
BEGIN
	IF uid IS NULL THEN
		RAISE EXCEPTION 'create_org needs a signed-in user' USING ERRCODE = '42501';
	END IF;
	IF clean_name IS NULL OR length(clean_name) NOT BETWEEN 1 AND 120 THEN
		RAISE EXCEPTION 'invalid label name' USING ERRCODE = '22023';
	END IF;
	IF org_slug IS NULL OR org_slug !~ '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$' THEN
		RAISE EXCEPTION 'invalid label slug' USING ERRCODE = '22023';
	END IF;
	-- A brake on abuse: an account may own at most three labels.
	IF (SELECT count(*) FROM memberships WHERE user_id = uid AND role = 'owner') >= 3 THEN
		RAISE EXCEPTION 'label limit reached' USING ERRCODE = '54000';
	END IF;
	INSERT INTO orgs (id, name, slug) VALUES (new_org, clean_name, org_slug);
	INSERT INTO memberships (org_id, user_id, role) VALUES (new_org, uid, 'owner');
	INSERT INTO audit_log (id, org_id, actor_id, actor_kind, entity, entity_id, action, after)
	VALUES (
		gen_random_uuid(), new_org, uid::text, 'user', 'org', new_org::text, 'create_org',
		jsonb_build_object('name', clean_name, 'slug', org_slug)
	);
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.create_org(uuid, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.create_org(uuid, text, text) TO erms_app;
