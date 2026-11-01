-- Pin search_path on app functions so a caller can't redirect name lookups
-- (Supabase advisor 0011_function_search_path_mutable).
ALTER FUNCTION app.current_user_id() SET search_path = '';--> statement-breakpoint
ALTER FUNCTION app.reject_audit_change() SET search_path = '';
