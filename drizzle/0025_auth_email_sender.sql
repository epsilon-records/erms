-- Send Email auth hook (EPSILON-147, decision 0027). Supabase Auth calls POST /api/auth/send-email
-- with a signed payload; the route picks the sender domain from the recipient's org memberships.
-- The route has no signed-in user, so it cannot use erms_app under RLS, and it must not use the
-- owner connection. It runs as erms_auth_email instead: a role that can log in nowhere, bypasses
-- no RLS and holds one privilege, EXECUTE on the function below. The function returns the org ids
-- of one account and nothing else: no names, roles, addresses or rows of any table.
DO $$ BEGIN
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'erms_auth_email') THEN
  CREATE ROLE erms_auth_email NOLOGIN NOBYPASSRLS NOINHERIT;
 END IF;
END $$;--> statement-breakpoint
GRANT erms_auth_email TO postgres;--> statement-breakpoint
CREATE SCHEMA app_auth_email;--> statement-breakpoint
REVOKE ALL ON SCHEMA app_auth_email FROM PUBLIC, anon, authenticated, service_role, erms_app;--> statement-breakpoint
CREATE FUNCTION app_auth_email.member_org_ids(p_user uuid) RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' SET statement_timeout = '1s' AS $$
 SELECT coalesce(pg_catalog.array_agg(m.org_id ORDER BY m.org_id), '{}'::uuid[])
 FROM public.memberships m
 WHERE m.user_id = p_user;
$$;--> statement-breakpoint
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_auth_email FROM PUBLIC, anon, authenticated, service_role, erms_app;--> statement-breakpoint
GRANT USAGE ON SCHEMA app_auth_email TO erms_auth_email;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_auth_email.member_org_ids(uuid) TO erms_auth_email;
