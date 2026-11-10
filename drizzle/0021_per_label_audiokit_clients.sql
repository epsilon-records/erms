CREATE TYPE "public"."audiokit_label_client_status" AS ENUM('pending', 'active', 'draining', 'revoked');--> statement-breakpoint
CREATE TABLE "audiokit_label_clients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"api_key_sealed" text,
	"webhook_secret_sealed" text,
	"key_prefix" text,
	"status" "audiokit_label_client_status" NOT NULL,
	"sync_state" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "audiokit_label_clients_secrets_while_live" CHECK (("audiokit_label_clients"."status" = 'revoked') = ("audiokit_label_clients"."api_key_sealed" IS NULL) AND ("audiokit_label_clients"."status" = 'revoked') = ("audiokit_label_clients"."webhook_secret_sealed" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "audiokit_jobs" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "audiokit_label_clients" ADD CONSTRAINT "audiokit_label_clients_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "audiokit_label_clients_client_key" ON "audiokit_label_clients" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "audiokit_label_clients_org_idx" ON "audiokit_label_clients" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "audiokit_label_clients_one_active" ON "audiokit_label_clients" USING btree ("org_id") WHERE "audiokit_label_clients"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "audiokit_label_clients_one_pending" ON "audiokit_label_clients" USING btree ("org_id") WHERE "audiokit_label_clients"."status" = 'pending';--> statement-breakpoint
ALTER TABLE "audiokit_jobs" ADD CONSTRAINT "audiokit_jobs_client_id_audiokit_label_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."audiokit_label_clients"("client_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Per-label AudioKit credentials (EPSILON-102, shared 0021/0022). The sealed key and secret must
-- never be readable by a member, so no role but the owner gets anything here: RLS is on with no
-- policy, and the grants Supabase's default privileges handed out are taken away as well (RLS does
-- not govern TRUNCATE, REFERENCES or TRIGGER). Only the AudioKit routes touch the table, on the
-- owner connection, after checking the caller themselves.
ALTER TABLE audiokit_label_clients ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE audiokit_label_clients FROM PUBLIC, anon, authenticated, service_role, erms_app;
