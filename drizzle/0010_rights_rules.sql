-- Phase 2 rules: one share per holder, shares total 100, RLS, and authorize().

-- One row per target, right, territory and holder. Holder and target ids are UUIDv7,
-- so coalescing a label id with a party id (or a recording with a composition) can't collide.
CREATE UNIQUE INDEX rights_shares_holder_key ON rights_shares (
	"right",
	coalesce(recording_id, composition_id),
	territory,
	coalesce(holder_label_id, holder_party_id)
);--> statement-breakpoint

/* --------------------------------------------------------------------------
   Totals. Checked at commit, so a set of shares can be edited row by row in one
   transaction, but never saved at anything other than 100 (or removed entirely).
   SECURITY DEFINER so the sum counts every row, not just those RLS shows.
   -------------------------------------------------------------------------- */

CREATE FUNCTION app.assert_rights_total(rt right_type, target uuid, terr text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE total numeric;
BEGIN
	SELECT coalesce(sum(share), 0) INTO total FROM rights_shares
	WHERE "right" = rt AND coalesce(recording_id, composition_id) = target AND territory = terr;
	IF total <> 0 AND total <> 100 THEN
		RAISE EXCEPTION USING
			MESSAGE = format('%s shares in %s total %s%%, not 100%%', rt, terr, trim_scale(total)),
			ERRCODE = '23514', CONSTRAINT = 'rights_shares_total';
	END IF;
END $$;--> statement-breakpoint

CREATE FUNCTION app.check_rights_total() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
	IF TG_OP IN ('UPDATE', 'DELETE') THEN
		PERFORM app.assert_rights_total(OLD."right", coalesce(OLD.recording_id, OLD.composition_id), OLD.territory);
	END IF;
	IF TG_OP IN ('INSERT', 'UPDATE') THEN
		PERFORM app.assert_rights_total(NEW."right", coalesce(NEW.recording_id, NEW.composition_id), NEW.territory);
	END IF;
	RETURN NULL;
END $$;--> statement-breakpoint

CREATE CONSTRAINT TRIGGER rights_shares_total
	AFTER INSERT OR UPDATE OR DELETE ON rights_shares
	DEFERRABLE INITIALLY DEFERRED
	FOR EACH ROW EXECUTE FUNCTION app.check_rights_total();--> statement-breakpoint

CREATE FUNCTION app.check_writers_total() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c uuid; total numeric;
BEGIN
	FOREACH c IN ARRAY ARRAY[
		CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.composition_id END,
		CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.composition_id END
	] LOOP
		CONTINUE WHEN c IS NULL;
		SELECT coalesce(sum(share), 0) INTO total FROM composition_writers WHERE composition_id = c;
		IF total <> 0 AND total <> 100 THEN
			RAISE EXCEPTION USING
				MESSAGE = format('writer splits total %s%%, not 100%%', trim_scale(total)),
				ERRCODE = '23514', CONSTRAINT = 'composition_writers_total';
		END IF;
	END LOOP;
	RETURN NULL;
END $$;--> statement-breakpoint

CREATE CONSTRAINT TRIGGER composition_writers_total
	AFTER INSERT OR UPDATE OR DELETE ON composition_writers
	DEFERRABLE INITIALLY DEFERRED
	FOR EACH ROW EXECUTE FUNCTION app.check_writers_total();--> statement-breakpoint

/* --------------------------------------------------------------------------
   RLS. Compositions and writers are catalog facts every member can read.
   Ownership, agreements and consents are visible to owners and rights admins only.
   Writes: owners and rights admins. Decisions are written only by app.authorize().
   -------------------------------------------------------------------------- */

ALTER TABLE compositions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE recording_compositions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE composition_writers ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE agreements ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE rights_shares ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE consents ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE authorization_decisions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY compositions_member_read ON compositions FOR SELECT USING (app.is_member(org_id));--> statement-breakpoint
CREATE POLICY recording_compositions_member_read ON recording_compositions FOR SELECT USING (app.is_member(org_id));--> statement-breakpoint
CREATE POLICY composition_writers_member_read ON composition_writers FOR SELECT USING (app.is_member(org_id));--> statement-breakpoint
CREATE POLICY agreements_rights_read ON agreements FOR SELECT USING (app.has_role(org_id, ARRAY['owner', 'rights_admin']));--> statement-breakpoint
CREATE POLICY rights_shares_rights_read ON rights_shares FOR SELECT USING (app.has_role(org_id, ARRAY['owner', 'rights_admin']));--> statement-breakpoint
CREATE POLICY consents_rights_read ON consents FOR SELECT USING (app.has_role(org_id, ARRAY['owner', 'rights_admin']));--> statement-breakpoint
CREATE POLICY authorization_decisions_read ON authorization_decisions FOR SELECT USING (app.has_role(org_id, ARRAY['owner', 'rights_admin', 'catalog_manager']));--> statement-breakpoint

CREATE POLICY compositions_rights_insert ON compositions FOR INSERT TO erms_app WITH CHECK (app.has_role(org_id, ARRAY['owner', 'rights_admin']));--> statement-breakpoint
CREATE POLICY compositions_rights_update ON compositions FOR UPDATE TO erms_app USING (app.has_role(org_id, ARRAY['owner', 'rights_admin'])) WITH CHECK (app.has_role(org_id, ARRAY['owner', 'rights_admin']));--> statement-breakpoint
CREATE POLICY compositions_rights_delete ON compositions FOR DELETE TO erms_app USING (app.has_role(org_id, ARRAY['owner', 'rights_admin']));--> statement-breakpoint
CREATE POLICY recording_compositions_rights_insert ON recording_compositions FOR INSERT TO erms_app WITH CHECK (app.has_role(org_id, ARRAY['owner', 'rights_admin']));--> statement-breakpoint
CREATE POLICY recording_compositions_rights_delete ON recording_compositions FOR DELETE TO erms_app USING (app.has_role(org_id, ARRAY['owner', 'rights_admin']));--> statement-breakpoint
CREATE POLICY composition_writers_rights_insert ON composition_writers FOR INSERT TO erms_app WITH CHECK (app.has_role(org_id, ARRAY['owner', 'rights_admin']));--> statement-breakpoint
CREATE POLICY composition_writers_rights_update ON composition_writers FOR UPDATE TO erms_app USING (app.has_role(org_id, ARRAY['owner', 'rights_admin'])) WITH CHECK (app.has_role(org_id, ARRAY['owner', 'rights_admin']));--> statement-breakpoint
CREATE POLICY composition_writers_rights_delete ON composition_writers FOR DELETE TO erms_app USING (app.has_role(org_id, ARRAY['owner', 'rights_admin']));--> statement-breakpoint
CREATE POLICY agreements_rights_insert ON agreements FOR INSERT TO erms_app WITH CHECK (app.has_role(org_id, ARRAY['owner', 'rights_admin']));--> statement-breakpoint
CREATE POLICY agreements_rights_update ON agreements FOR UPDATE TO erms_app USING (app.has_role(org_id, ARRAY['owner', 'rights_admin'])) WITH CHECK (app.has_role(org_id, ARRAY['owner', 'rights_admin']));--> statement-breakpoint
CREATE POLICY agreements_rights_delete ON agreements FOR DELETE TO erms_app USING (app.has_role(org_id, ARRAY['owner', 'rights_admin']));--> statement-breakpoint
CREATE POLICY rights_shares_rights_insert ON rights_shares FOR INSERT TO erms_app WITH CHECK (app.has_role(org_id, ARRAY['owner', 'rights_admin']));--> statement-breakpoint
CREATE POLICY rights_shares_rights_update ON rights_shares FOR UPDATE TO erms_app USING (app.has_role(org_id, ARRAY['owner', 'rights_admin'])) WITH CHECK (app.has_role(org_id, ARRAY['owner', 'rights_admin']));--> statement-breakpoint
CREATE POLICY rights_shares_rights_delete ON rights_shares FOR DELETE TO erms_app USING (app.has_role(org_id, ARRAY['owner', 'rights_admin']));--> statement-breakpoint
CREATE POLICY consents_rights_insert ON consents FOR INSERT TO erms_app WITH CHECK (app.has_role(org_id, ARRAY['owner', 'rights_admin']));--> statement-breakpoint
CREATE POLICY consents_rights_update ON consents FOR UPDATE TO erms_app USING (app.has_role(org_id, ARRAY['owner', 'rights_admin'])) WITH CHECK (app.has_role(org_id, ARRAY['owner', 'rights_admin']));--> statement-breakpoint
CREATE POLICY consents_rights_delete ON consents FOR DELETE TO erms_app USING (app.has_role(org_id, ARRAY['owner', 'rights_admin']));--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON compositions, composition_writers, agreements, rights_shares, consents TO erms_app;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON recording_compositions TO erms_app;--> statement-breakpoint
GRANT SELECT ON authorization_decisions TO erms_app;--> statement-breakpoint

/* --------------------------------------------------------------------------
   authorize(): may this recording be processed for this purpose?

   Every purpose needs complete worldwide master ownership and some share held by one
   of the org's labels. On top of that:
     analysis, transcode      nothing more
     stem_separation,         the labels hold 100% worldwide, or there is an active
     mastering                consent for the purpose covering the recording
     voice, generation        an active consent from every main artist

   The verdict is recorded in the same call, so a caller can't write its own "allowed",
   and callers who may request processing but not read rights (catalog managers,
   agents) get a decision without seeing the contracts behind it.
   -------------------------------------------------------------------------- */

CREATE FUNCTION app.authorize(target_org uuid, target_recording uuid, wanted processing_purpose)
RETURNS authorization_decisions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
	caller_role text;
	master_complete boolean;
	our_share numeric;
	consent_ids uuid[];
	main_artists uuid[];
	consenting uuid[];
	missing uuid[];
	reasons text[] := ARRAY[]::text[];
	decision authorization_decisions;
BEGIN
	SELECT m.role::text INTO caller_role FROM memberships m
	WHERE m.org_id = target_org AND m.user_id = app.current_user_id();
	IF caller_role IS NULL OR caller_role NOT IN ('owner', 'catalog_manager', 'agent') THEN
		RAISE EXCEPTION 'not allowed to request processing' USING ERRCODE = '42501';
	END IF;
	IF NOT EXISTS (SELECT 1 FROM recordings WHERE id = target_recording AND org_id = target_org) THEN
		RAISE EXCEPTION 'recording not found' USING ERRCODE = 'P0002';
	END IF;

	SELECT EXISTS (
		SELECT 1 FROM rights_shares
		WHERE org_id = target_org AND recording_id = target_recording AND "right" = 'master' AND territory = 'WW'
	), coalesce((
		SELECT sum(share) FROM rights_shares
		WHERE org_id = target_org AND recording_id = target_recording AND "right" = 'master'
			AND territory = 'WW' AND holder_label_id IS NOT NULL
	), 0)
	INTO master_complete, our_share;

	SELECT coalesce(array_agg(DISTINCT c.party_id), ARRAY[]::uuid[]) INTO main_artists
	FROM credits c WHERE c.org_id = target_org AND c.recording_id = target_recording AND c.role = 'main';

	-- Active consents for this purpose: for this recording, or blanket consents from
	-- someone credited on it.
	SELECT coalesce(array_agg(k.id), ARRAY[]::uuid[]), coalesce(array_agg(DISTINCT k.party_id), ARRAY[]::uuid[])
	INTO consent_ids, consenting
	FROM consents k
	WHERE k.org_id = target_org AND k.purpose = wanted
		AND k.revoked_at IS NULL
		AND k.granted_on <= current_date
		AND (k.expires_on IS NULL OR k.expires_on >= current_date)
		AND (k.recording_id = target_recording OR (k.recording_id IS NULL AND EXISTS (
			SELECT 1 FROM credits c WHERE c.recording_id = target_recording AND c.party_id = k.party_id
		)));

	IF NOT master_complete THEN
		reasons := reasons || 'master_incomplete'::text;
	END IF;
	IF our_share = 0 THEN
		reasons := reasons || 'not_controlled'::text;
	END IF;

	missing := ARRAY(SELECT unnest(main_artists) EXCEPT SELECT unnest(consenting));
	IF wanted IN ('stem_separation', 'mastering') AND our_share < 100 AND cardinality(consent_ids) = 0 THEN
		reasons := reasons || 'consent_missing'::text;
	ELSIF wanted IN ('voice', 'generation') THEN
		IF cardinality(main_artists) = 0 THEN
			reasons := reasons || 'no_main_artist'::text;
		ELSIF cardinality(missing) > 0 THEN
			reasons := reasons || 'consent_missing'::text;
		END IF;
	END IF;

	INSERT INTO authorization_decisions
		(id, org_id, recording_id, purpose, allowed, reasons, basis, actor_id, actor_kind)
	VALUES (
		gen_random_uuid(), target_org, target_recording, wanted, cardinality(reasons) = 0,
		to_jsonb(reasons),
		jsonb_build_object(
			'master_complete', master_complete,
			'label_share', trim_scale(our_share),
			'consents', to_jsonb(consent_ids),
			'main_artists', to_jsonb(main_artists),
			'missing_consent', CASE WHEN wanted IN ('voice', 'generation') THEN to_jsonb(missing) ELSE '[]'::jsonb END
		),
		app.current_user_id()::text,
		CASE WHEN caller_role = 'agent' THEN 'agent'::actor_kind ELSE 'user'::actor_kind END
	)
	RETURNING * INTO decision;
	RETURN decision;
END $$;--> statement-breakpoint

REVOKE ALL ON FUNCTION app.authorize(uuid, uuid, processing_purpose) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.authorize(uuid, uuid, processing_purpose) TO erms_app;
