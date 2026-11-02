-- Catalog search. Words match as prefixes, accents and case are ignored, and
-- identifiers (ISRC, UPC, catalog number) also match with or without dashes and spaces.
-- Searches run as erms_app, so RLS still decides which rows a user can see.
CREATE SCHEMA IF NOT EXISTS extensions;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;--> statement-breakpoint
GRANT USAGE ON SCHEMA extensions TO erms_app;--> statement-breakpoint

-- Lowercased, accent-free text, e.g. 'Rhône' -> 'rhone'.
CREATE FUNCTION app.search_text(t text) RETURNS text
	LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = ''
	AS $$ SELECT lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(t, ''))) $$;--> statement-breakpoint

-- Every word must match the start of some word in the document: 'vex ra' finds 'Vexo Rand'.
-- NULL when the query has no letters or digits, which matches nothing.
CREATE FUNCTION app.search_query(q text) RETURNS tsquery
	LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = ''
	AS $$
		SELECT pg_catalog.to_tsquery('pg_catalog.simple', pg_catalog.string_agg(pg_catalog.quote_literal(w) || ':*', ' & '))
		FROM pg_catalog.regexp_split_to_table(app.search_text(q), '[^[:alnum:]]+') AS w
		WHERE w <> ''
	$$;--> statement-breakpoint

-- Identifiers compared without separators: 'zz-aa1-25-95068' -> 'ZZAA12595068'.
CREATE FUNCTION app.search_code(t text) RETURNS text
	LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = ''
	AS $$ SELECT upper(pg_catalog.regexp_replace(coalesce(t, ''), '[^[:alnum:]]', '', 'g')) $$;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION app.search_text(text), app.search_query(text), app.search_code(text) TO erms_app;
