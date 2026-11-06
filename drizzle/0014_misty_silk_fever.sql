ALTER TABLE "memberships" ADD COLUMN "onboarded_at" timestamp with time zone;--> statement-breakpoint
-- Onboarding flag is read through RLS, but the app role has no UPDATE on memberships.
-- This SECURITY DEFINER function lets a member stamp only their own membership.
CREATE FUNCTION app.complete_onboarding(target_org uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
	UPDATE memberships SET onboarded_at = now()
	WHERE org_id = target_org AND user_id = app.current_user_id()
$$;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.complete_onboarding(uuid) TO erms_app;
