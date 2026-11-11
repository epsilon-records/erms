-- Per-customer branding and custom domains (EPSILON-132). Read by the request hook to brand a
-- request by its host; erms_app keeps SELECT-only on orgs.
ALTER TABLE "orgs" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "accent_color" text;--> statement-breakpoint
ALTER TABLE "orgs" ADD COLUMN "custom_domain" text;--> statement-breakpoint
CREATE UNIQUE INDEX "orgs_custom_domain_key" ON "orgs" USING btree ("custom_domain");--> statement-breakpoint
ALTER TABLE "orgs" ADD CONSTRAINT "orgs_display_name_length" CHECK ("orgs"."display_name" IS NULL OR length("orgs"."display_name") BETWEEN 1 AND 60);--> statement-breakpoint
ALTER TABLE "orgs" ADD CONSTRAINT "orgs_accent_color_format" CHECK ("orgs"."accent_color" IS NULL OR "orgs"."accent_color" ~ '^#[0-9a-f]{6}$');--> statement-breakpoint
ALTER TABLE "orgs" ADD CONSTRAINT "orgs_custom_domain_format" CHECK ("orgs"."custom_domain" IS NULL OR "orgs"."custom_domain" ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$');--> statement-breakpoint
-- Epsilon Records is the first branded customer: ERMS on erms.epsilonrecords.com. A no-op where
-- the org does not exist (local and test databases).
UPDATE orgs SET display_name = 'ERMS', custom_domain = 'erms.epsilonrecords.com' WHERE slug = 'epsilon-records';
