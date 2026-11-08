ALTER TABLE "audit_log" ADD COLUMN "transaction_id" bigint DEFAULT txid_current() NOT NULL;--> statement-breakpoint

-- Use the top-level transaction id so audit checks also work across withAudit savepoints.
-- Stamp on insertion rather than trusting a caller-supplied transaction id.
CREATE FUNCTION app.stamp_audit_transaction() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN NEW.transaction_id := txid_current(); RETURN NEW; END
$$;--> statement-breakpoint
CREATE TRIGGER audit_transaction BEFORE INSERT ON public.audit_log
FOR EACH ROW EXECUTE FUNCTION app.stamp_audit_transaction();--> statement-breakpoint

-- Membership administration is owner-only under the same RLS boundary as routes.
GRANT INSERT, UPDATE (role, email), DELETE ON public.memberships TO erms_app;--> statement-breakpoint
CREATE POLICY memberships_owner_insert ON public.memberships FOR INSERT TO erms_app
WITH CHECK (app.has_role(org_id, ARRAY['owner']) AND role::text IN ('owner','catalog_manager','rights_admin','viewer'));--> statement-breakpoint
CREATE POLICY memberships_owner_update ON public.memberships FOR UPDATE TO erms_app
USING (app.has_role(org_id, ARRAY['owner']))
WITH CHECK (app.has_role(org_id, ARRAY['owner']) AND role::text IN ('owner','catalog_manager','rights_admin','viewer'));--> statement-breakpoint
CREATE POLICY memberships_owner_delete ON public.memberships FOR DELETE TO erms_app
USING (app.has_role(org_id, ARRAY['owner']));--> statement-breakpoint

-- Serialize the owner count and every member mutation within each org, including concurrent
-- demotions/removals. Different orgs do not block each other. No caller can choose another org.
CREATE FUNCTION app.lock_members(target_org uuid) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = '' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('erms-members:' || target_org::text, 0));
  IF NOT app.has_role(target_org, ARRAY['owner']) THEN
    RAISE EXCEPTION 'Only an owner of this label can manage members' USING ERRCODE = '42501';
  END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.lock_members(uuid) FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.lock_members(uuid) TO erms_app;--> statement-breakpoint

-- SECURITY DEFINER only for counting all owners, never for a mutation. Invoker RLS still
-- checks the write itself. The owner connection can perform fixture/administrative cleanup.
CREATE FUNCTION app.guard_membership() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE target uuid;
BEGIN
  IF current_user <> 'erms_app' THEN RETURN COALESCE(NEW, OLD); END IF;
  target := COALESCE(NEW.org_id, OLD.org_id);
  PERFORM app.lock_members(target);
  IF TG_OP = 'UPDATE' AND (NEW.org_id <> OLD.org_id OR NEW.user_id <> OLD.user_id) THEN
    RAISE EXCEPTION 'Membership identity is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP IN ('DELETE','UPDATE') AND OLD.role = 'owner'
      AND (TG_OP = 'DELETE' OR NEW.role <> 'owner')
      AND app.owner_count(target) <= 1 THEN
    RAISE EXCEPTION 'A label must keep at least one owner' USING ERRCODE = '23514';
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$$;--> statement-breakpoint
CREATE FUNCTION app.owner_count(target_org uuid) RETURNS bigint
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE total bigint;
BEGIN
  IF NOT app.has_role(target_org, ARRAY['owner']) THEN
    RAISE EXCEPTION 'Only an owner of this label can count owners' USING ERRCODE = '42501';
  END IF;
  SELECT count(*) INTO total FROM public.memberships WHERE org_id = target_org AND role = 'owner';
  RETURN total;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.owner_count(uuid) FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.owner_count(uuid) TO erms_app;--> statement-breakpoint
CREATE TRIGGER memberships_guard BEFORE INSERT OR UPDATE OR DELETE ON public.memberships
FOR EACH ROW EXECUTE FUNCTION app.guard_membership();--> statement-breakpoint

-- Direct SQL through the app role must leave an audit entry too. Deferred until commit
-- because withAudit writes within the same transaction; checked as definer so removing
-- oneself does not hide the audit row. Onboarding changes are handled by the existing
-- narrow complete_onboarding function and do not change role/email/identity.
CREATE FUNCTION app.require_membership_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target_org uuid; target_user uuid; expected_action text;
BEGIN
  IF current_setting('role') <> 'erms_app' THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND NEW.role = OLD.role AND NEW.email IS NOT DISTINCT FROM OLD.email
      AND NEW.org_id = OLD.org_id AND NEW.user_id = OLD.user_id THEN RETURN NULL; END IF;
  target_org := COALESCE(NEW.org_id, OLD.org_id);
  target_user := COALESCE(NEW.user_id, OLD.user_id);
  expected_action := CASE TG_OP WHEN 'INSERT' THEN 'invited' WHEN 'UPDATE' THEN 'role_changed' ELSE 'removed' END;
  IF NOT EXISTS (
    SELECT 1 FROM public.audit_log a WHERE a.org_id = target_org
      AND a.entity = 'membership' AND a.entity_id = target_user::text
      AND a.action = expected_action AND a.actor_kind = 'user'
      AND a.actor_id = app.current_user_id()::text
      AND a.transaction_id = txid_current()
  ) THEN RAISE EXCEPTION 'Membership changes require an audit entry in the same transaction' USING ERRCODE = '23514'; END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER memberships_audit AFTER INSERT OR UPDATE OR DELETE ON public.memberships
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.require_membership_audit();--> statement-breakpoint

-- Functions remain SECURITY INVOKER: no bypass for stale/cross-org owners or API roles.
CREATE FUNCTION app.add_member(target_org uuid, target_user uuid, target_email text, target_role public.role) RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  PERFORM app.lock_members(target_org);
  INSERT INTO public.memberships (org_id,user_id,email,role) VALUES (target_org,target_user,lower(btrim(target_email)),target_role);
END
$$;--> statement-breakpoint
CREATE FUNCTION app.change_member_role(target_org uuid, target_user uuid, target_role public.role) RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  PERFORM app.lock_members(target_org);
  UPDATE public.memberships SET role = target_role WHERE org_id = target_org AND user_id = target_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'Member not found' USING ERRCODE = 'P0002'; END IF;
END
$$;--> statement-breakpoint
CREATE FUNCTION app.remove_member(target_org uuid, target_user uuid) RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  PERFORM app.lock_members(target_org);
  DELETE FROM public.memberships WHERE org_id = target_org AND user_id = target_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'Member not found' USING ERRCODE = 'P0002'; END IF;
END
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION app.add_member(uuid,uuid,text,public.role), app.change_member_role(uuid,uuid,public.role), app.remove_member(uuid,uuid) FROM PUBLIC, anon, authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.add_member(uuid,uuid,text,public.role), app.change_member_role(uuid,uuid,public.role), app.remove_member(uuid,uuid) TO erms_app;
