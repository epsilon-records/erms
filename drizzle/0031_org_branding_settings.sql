ALTER TABLE "orgs" ADD COLUMN "favicon_png" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD CONSTRAINT "orgs_favicon_png_format" CHECK ("orgs"."favicon_png" IS NULL OR ("orgs"."favicon_png" LIKE 'iVBORw0KGgo%' AND length("orgs"."favicon_png") <= 44000));--> statement-breakpoint
-- Tenant branding settings (shared rule: anything one tenant can do, every tenant can do).
-- An owner sets the label's display name, accent colour and tab icon on /org/branding through
-- app.set_org_branding. labelkit_app keeps SELECT-only on orgs, so this SECURITY DEFINER function is
-- the one write path; it checks the role and writes the audit log, like app.close_org. Null for the
-- name or accent resets it to the product default. icon_op says what happens to the icon: 'keep'
-- leaves whatever is stored when the row is locked (so a save that does not touch the icon cannot
-- undo another owner's upload), 'replace' stores new_favicon, 'remove' clears it. Relations are
-- schema-qualified so a session's temporary tables cannot shadow them.
CREATE FUNCTION app.set_org_branding(
	target_org uuid,
	new_display_name text,
	new_accent text,
	icon_op text,
	new_favicon text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
	uid uuid := app.current_user_id();
	prev public.orgs%ROWTYPE;
	next_favicon text;
BEGIN
	IF uid IS NULL OR NOT app.has_role(target_org, ARRAY['owner']) THEN
		RAISE EXCEPTION 'only an owner can change the branding' USING ERRCODE = '42501';
	END IF;
	IF icon_op IS NULL OR icon_op NOT IN ('keep', 'replace', 'remove')
		OR (icon_op = 'replace') <> (new_favicon IS NOT NULL) THEN
		RAISE EXCEPTION 'icon_op must be keep, replace (with an icon) or remove' USING ERRCODE = '22023';
	END IF;
	SELECT * INTO prev FROM public.orgs WHERE id = target_org FOR UPDATE;
	next_favicon := CASE icon_op WHEN 'keep' THEN prev.favicon_png WHEN 'replace' THEN new_favicon END;
	UPDATE public.orgs
	SET display_name = new_display_name, accent_color = new_accent, favicon_png = next_favicon
	WHERE id = target_org;
	INSERT INTO public.audit_log (id, org_id, actor_id, actor_kind, entity, entity_id, action, before, after)
	VALUES (gen_random_uuid(), target_org, uid::text, 'user', 'org', target_org::text, 'set_branding',
		jsonb_build_object('display_name', prev.display_name, 'accent_color', prev.accent_color,
			'favicon_bytes', length(decode(prev.favicon_png, 'base64'))),
		jsonb_build_object('display_name', new_display_name, 'accent_color', new_accent,
			'favicon_bytes', length(decode(next_favicon, 'base64'))));
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.set_org_branding(uuid, text, text, text, text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.set_org_branding(uuid, text, text, text, text) TO labelkit_app;
