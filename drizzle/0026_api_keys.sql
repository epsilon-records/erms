CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"key_sha256" text NOT NULL,
	"scopes" text[] NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_keys_name_length" CHECK (length("api_keys"."name") BETWEEN 1 AND 60),
	CONSTRAINT "api_keys_prefix_format" CHECK ("api_keys"."prefix" ~ '^[a-z0-9]{8}$'),
	CONSTRAINT "api_keys_sha256_format" CHECK ("api_keys"."key_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "api_keys_scopes_allowed" CHECK ("api_keys"."scopes" <@ ARRAY['catalog:read','processing:request']::text[] AND cardinality("api_keys"."scopes") > 0)
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_actor_key" ON "api_keys" USING btree ("actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_prefix_key" ON "api_keys" USING btree ("prefix");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_sha256_key" ON "api_keys" USING btree ("key_sha256");--> statement-breakpoint
CREATE INDEX "api_keys_org_idx" ON "api_keys" USING btree ("org_id","created_at");--> statement-breakpoint

-- API keys for the public /v1 API (EPSILON-137). Each key acts as an `agent` member of its org,
-- so /v1 runs under the same RLS as the app, as that agent. Owners see their org's keys (never
-- the hash); creating and revoking goes through the two functions below, which also add and
-- remove the agent membership and write the audit entry. erms_app gets no INSERT, UPDATE or
-- DELETE on api_keys, and the memberships insert policy still refuses `agent` from the app.
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT (id, org_id, actor_id, name, prefix, scopes, created_by, created_at, last_used_at, revoked_at)
	ON api_keys TO erms_app;--> statement-breakpoint
CREATE POLICY api_keys_owner_read ON api_keys FOR SELECT TO erms_app
	USING (app.has_role(org_id, ARRAY['owner']));--> statement-breakpoint

CREATE FUNCTION app.create_api_key(
	new_key uuid, target_org uuid, key_name text, key_prefix text, key_hash text, key_scopes text[]
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
	uid uuid := app.current_user_id();
	actor uuid := gen_random_uuid();
	clean_name text := btrim(key_name);
BEGIN
	IF uid IS NULL OR NOT app.has_role(target_org, ARRAY['owner']) THEN
		RAISE EXCEPTION 'only an owner can create API keys' USING ERRCODE = '42501';
	END IF;
	-- A brake on abuse, and on keys nobody remembers: at most 10 live keys per label.
	IF (SELECT count(*) FROM api_keys WHERE org_id = target_org AND revoked_at IS NULL) >= 10 THEN
		RAISE EXCEPTION 'API key limit reached' USING ERRCODE = '54000';
	END IF;
	INSERT INTO memberships (org_id, user_id, role, onboarded_at) VALUES (target_org, actor, 'agent', now());
	INSERT INTO api_keys (id, org_id, actor_id, name, prefix, key_sha256, scopes, created_by)
	VALUES (new_key, target_org, actor, clean_name, key_prefix, key_hash, key_scopes, uid);
	INSERT INTO audit_log (id, org_id, actor_id, actor_kind, entity, entity_id, action, after)
	VALUES (
		gen_random_uuid(), target_org, uid::text, 'user', 'api_key', new_key::text, 'api_key_create',
		jsonb_build_object('name', clean_name, 'prefix', key_prefix, 'scopes', to_jsonb(key_scopes))
	);
	RETURN actor;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.create_api_key(uuid, uuid, text, text, text, text[]) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.create_api_key(uuid, uuid, text, text, text, text[]) TO erms_app;--> statement-breakpoint

CREATE FUNCTION app.revoke_api_key(target_key uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
	uid uuid := app.current_user_id();
	k api_keys%ROWTYPE;
BEGIN
	SELECT * INTO k FROM api_keys WHERE id = target_key FOR UPDATE;
	IF NOT FOUND OR uid IS NULL OR NOT app.has_role(k.org_id, ARRAY['owner']) THEN
		RAISE EXCEPTION 'API key not found' USING ERRCODE = '42501';
	END IF;
	IF k.revoked_at IS NOT NULL THEN
		RETURN false;
	END IF;
	UPDATE api_keys SET revoked_at = now() WHERE id = target_key;
	-- The agent's membership goes with the key, so a revoked key can read nothing even if it
	-- were somehow still presented.
	DELETE FROM memberships WHERE org_id = k.org_id AND user_id = k.actor_id AND role = 'agent';
	INSERT INTO audit_log (id, org_id, actor_id, actor_kind, entity, entity_id, action, before)
	VALUES (
		gen_random_uuid(), k.org_id, uid::text, 'user', 'api_key', k.id::text, 'api_key_revoke',
		jsonb_build_object('name', k.name, 'prefix', k.prefix)
	);
	RETURN true;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.revoke_api_key(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.revoke_api_key(uuid) TO erms_app;
