-- Disabled pilot: controller-reviewed technical defaults, not a Nate retention decision.
-- No event rows. Private schema is deliberately absent from PostgREST exposed schemas.
DO $$ BEGIN
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'erms_metrics_ingest') THEN
  CREATE ROLE erms_metrics_ingest NOLOGIN NOBYPASSRLS NOINHERIT;
 END IF;
 IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'erms_metrics_prune') THEN
  CREATE ROLE erms_metrics_prune NOLOGIN NOBYPASSRLS NOINHERIT;
 END IF;
END $$;--> statement-breakpoint
GRANT erms_metrics_ingest, erms_metrics_prune TO postgres;--> statement-breakpoint
CREATE SCHEMA app_metrics;--> statement-breakpoint
REVOKE ALL ON SCHEMA app_metrics FROM PUBLIC, anon, authenticated, service_role, erms_app;--> statement-breakpoint
CREATE TABLE app_metrics.app_performance_daily (
 day_utc date NOT NULL,
 route_code smallint NOT NULL,
 metric_code smallint NOT NULL,
 bucket smallint NOT NULL,
 count bigint NOT NULL CHECK (count BETWEEN 0 AND 2000),
 PRIMARY KEY (day_utc, route_code, metric_code, bucket),
 CHECK ((route_code = 0 AND metric_code = 0 AND bucket = 0)
     OR (route_code = 1 AND metric_code IN (1,2) AND bucket BETWEEN 1 AND 8))
);--> statement-breakpoint
ALTER TABLE app_metrics.app_performance_daily ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Supabase default grants may apply even in private schemas: revoke explicitly.
REVOKE ALL ON ALL TABLES IN SCHEMA app_metrics FROM PUBLIC, anon, authenticated, service_role, erms_app, erms_metrics_ingest, erms_metrics_prune;--> statement-breakpoint
CREATE FUNCTION app_metrics.record(r smallint, m smallint, b smallint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' SET lock_timeout = '100ms' SET statement_timeout = '250ms' AS $$
DECLARE today date := (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::date;
BEGIN
 IF r IS NULL OR m IS NULL OR b IS NULL OR r <> 1 OR m NOT IN (1,2) OR b NOT BETWEEN 1 AND 8 THEN
  RAISE EXCEPTION 'invalid metric code' USING ERRCODE = '22023';
 END IF;
 DELETE FROM app_metrics.app_performance_daily WHERE day_utc < today - 7;
 INSERT INTO app_metrics.app_performance_daily VALUES (today,0,0,0,1)
 ON CONFLICT (day_utc,route_code,metric_code,bucket) DO UPDATE
 SET count = app_performance_daily.count + 1 WHERE app_performance_daily.count < 2000;
 IF NOT FOUND THEN RETURN false; END IF;
 INSERT INTO app_metrics.app_performance_daily VALUES (today,r,m,b,1)
 ON CONFLICT (day_utc,route_code,metric_code,bucket) DO UPDATE SET count = app_performance_daily.count + 1;
 RETURN true;
END $$;--> statement-breakpoint
CREATE FUNCTION app_metrics.prune() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' SET lock_timeout = '100ms' SET statement_timeout = '250ms' AS $$
 DELETE FROM app_metrics.app_performance_daily
 WHERE day_utc < (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::date - 7;
$$;--> statement-breakpoint
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_metrics FROM PUBLIC, anon, authenticated, service_role, erms_app, erms_metrics_ingest, erms_metrics_prune;--> statement-breakpoint
GRANT USAGE ON SCHEMA app_metrics TO erms_metrics_ingest, erms_metrics_prune;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_metrics.record(smallint,smallint,smallint) TO erms_metrics_ingest;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_metrics.prune() TO erms_metrics_prune;
