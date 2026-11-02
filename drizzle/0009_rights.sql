CREATE TYPE "public"."agreement_kind" AS ENUM('recording', 'license', 'publishing', 'remix', 'distribution', 'other');--> statement-breakpoint
CREATE TYPE "public"."agreement_status" AS ENUM('draft', 'active', 'expired', 'terminated');--> statement-breakpoint
CREATE TYPE "public"."processing_purpose" AS ENUM('analysis', 'transcode', 'stem_separation', 'mastering', 'voice', 'generation');--> statement-breakpoint
CREATE TYPE "public"."right_type" AS ENUM('master', 'publishing');--> statement-breakpoint
CREATE TYPE "public"."writer_role" AS ENUM('composer', 'lyricist', 'composer_lyricist', 'arranger');--> statement-breakpoint
CREATE TABLE "agreements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"label_id" uuid NOT NULL,
	"counterparty_id" uuid NOT NULL,
	"kind" "agreement_kind" NOT NULL,
	"title" text NOT NULL,
	"status" "agreement_status" DEFAULT 'draft' NOT NULL,
	"signed_on" date,
	"starts_on" date,
	"ends_on" date,
	"territory" text DEFAULT 'WW' NOT NULL,
	"document_path" text,
	"document_sha256" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agreements_org_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "agreements_territory_format" CHECK ("agreements"."territory" ~ '^(WW|[A-Z]{2})$'),
	CONSTRAINT "agreements_term_order" CHECK ("agreements"."ends_on" IS NULL OR "agreements"."starts_on" IS NULL OR "agreements"."ends_on" >= "agreements"."starts_on"),
	CONSTRAINT "agreements_document_pair" CHECK (("agreements"."document_path" IS NULL) = ("agreements"."document_sha256" IS NULL) AND ("agreements"."document_sha256" IS NULL OR "agreements"."document_sha256" ~ '^[0-9a-f]{64}$'))
);
--> statement-breakpoint
CREATE TABLE "authorization_decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"recording_id" uuid NOT NULL,
	"purpose" "processing_purpose" NOT NULL,
	"allowed" boolean NOT NULL,
	"reasons" jsonb NOT NULL,
	"basis" jsonb NOT NULL,
	"actor_id" text NOT NULL,
	"actor_kind" "actor_kind" NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "composition_writers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"composition_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"role" "writer_role" NOT NULL,
	"share" numeric(7, 4) NOT NULL,
	CONSTRAINT "composition_writers_share_range" CHECK ("composition_writers"."share" > 0 AND "composition_writers"."share" <= 100)
);
--> statement-breakpoint
CREATE TABLE "compositions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"title" text NOT NULL,
	"iswc" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compositions_org_id_key" UNIQUE("org_id","id"),
	CONSTRAINT "compositions_iswc_format" CHECK ("compositions"."iswc" IS NULL OR "compositions"."iswc" ~ '^T[0-9]{10}$')
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"party_id" uuid NOT NULL,
	"purpose" "processing_purpose" NOT NULL,
	"recording_id" uuid,
	"agreement_id" uuid,
	"granted_on" date NOT NULL,
	"expires_on" date,
	"revoked_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consents_term_order" CHECK ("consents"."expires_on" IS NULL OR "consents"."expires_on" >= "consents"."granted_on")
);
--> statement-breakpoint
CREATE TABLE "recording_compositions" (
	"org_id" uuid NOT NULL,
	"recording_id" uuid NOT NULL,
	"composition_id" uuid NOT NULL,
	CONSTRAINT "recording_compositions_recording_id_composition_id_pk" PRIMARY KEY("recording_id","composition_id")
);
--> statement-breakpoint
CREATE TABLE "rights_shares" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"right" "right_type" NOT NULL,
	"recording_id" uuid,
	"composition_id" uuid,
	"holder_label_id" uuid,
	"holder_party_id" uuid,
	"territory" text DEFAULT 'WW' NOT NULL,
	"share" numeric(7, 4) NOT NULL,
	"agreement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rights_shares_target_matches_right" CHECK (("rights_shares"."right" = 'master' AND "rights_shares"."recording_id" IS NOT NULL AND "rights_shares"."composition_id" IS NULL) OR ("rights_shares"."right" = 'publishing' AND "rights_shares"."composition_id" IS NOT NULL AND "rights_shares"."recording_id" IS NULL)),
	CONSTRAINT "rights_shares_one_holder" CHECK (("rights_shares"."holder_label_id" IS NULL) <> ("rights_shares"."holder_party_id" IS NULL)),
	CONSTRAINT "rights_shares_share_range" CHECK ("rights_shares"."share" > 0 AND "rights_shares"."share" <= 100),
	CONSTRAINT "rights_shares_territory_format" CHECK ("rights_shares"."territory" ~ '^(WW|[A-Z]{2})$')
);
--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_label_same_org_fk" FOREIGN KEY ("org_id","label_id") REFERENCES "public"."labels"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agreements" ADD CONSTRAINT "agreements_counterparty_same_org_fk" FOREIGN KEY ("org_id","counterparty_id") REFERENCES "public"."parties"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorization_decisions" ADD CONSTRAINT "authorization_decisions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authorization_decisions" ADD CONSTRAINT "authorization_decisions_recording_same_org_fk" FOREIGN KEY ("org_id","recording_id") REFERENCES "public"."recordings"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "composition_writers" ADD CONSTRAINT "composition_writers_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "composition_writers" ADD CONSTRAINT "composition_writers_composition_same_org_fk" FOREIGN KEY ("org_id","composition_id") REFERENCES "public"."compositions"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "composition_writers" ADD CONSTRAINT "composition_writers_party_same_org_fk" FOREIGN KEY ("org_id","party_id") REFERENCES "public"."parties"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compositions" ADD CONSTRAINT "compositions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_party_same_org_fk" FOREIGN KEY ("org_id","party_id") REFERENCES "public"."parties"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_recording_same_org_fk" FOREIGN KEY ("org_id","recording_id") REFERENCES "public"."recordings"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_agreement_same_org_fk" FOREIGN KEY ("org_id","agreement_id") REFERENCES "public"."agreements"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording_compositions" ADD CONSTRAINT "recording_compositions_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording_compositions" ADD CONSTRAINT "recording_compositions_recording_same_org_fk" FOREIGN KEY ("org_id","recording_id") REFERENCES "public"."recordings"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recording_compositions" ADD CONSTRAINT "recording_compositions_composition_same_org_fk" FOREIGN KEY ("org_id","composition_id") REFERENCES "public"."compositions"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rights_shares" ADD CONSTRAINT "rights_shares_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rights_shares" ADD CONSTRAINT "rights_shares_recording_same_org_fk" FOREIGN KEY ("org_id","recording_id") REFERENCES "public"."recordings"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rights_shares" ADD CONSTRAINT "rights_shares_composition_same_org_fk" FOREIGN KEY ("org_id","composition_id") REFERENCES "public"."compositions"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rights_shares" ADD CONSTRAINT "rights_shares_label_same_org_fk" FOREIGN KEY ("org_id","holder_label_id") REFERENCES "public"."labels"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rights_shares" ADD CONSTRAINT "rights_shares_party_same_org_fk" FOREIGN KEY ("org_id","holder_party_id") REFERENCES "public"."parties"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rights_shares" ADD CONSTRAINT "rights_shares_agreement_same_org_fk" FOREIGN KEY ("org_id","agreement_id") REFERENCES "public"."agreements"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agreements_org_counterparty_idx" ON "agreements" USING btree ("org_id","counterparty_id");--> statement-breakpoint
CREATE INDEX "authorization_decisions_org_recording_idx" ON "authorization_decisions" USING btree ("org_id","recording_id","decided_at");--> statement-breakpoint
CREATE UNIQUE INDEX "composition_writers_party_role_key" ON "composition_writers" USING btree ("composition_id","party_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "compositions_org_iswc_key" ON "compositions" USING btree ("org_id","iswc");--> statement-breakpoint
CREATE INDEX "consents_org_party_idx" ON "consents" USING btree ("org_id","party_id");--> statement-breakpoint
CREATE INDEX "recording_compositions_composition_idx" ON "recording_compositions" USING btree ("composition_id");--> statement-breakpoint
CREATE INDEX "rights_shares_org_recording_idx" ON "rights_shares" USING btree ("org_id","recording_id");--> statement-breakpoint
CREATE INDEX "rights_shares_org_composition_idx" ON "rights_shares" USING btree ("org_id","composition_id");