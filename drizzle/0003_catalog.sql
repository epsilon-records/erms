CREATE TYPE "public"."credit_role" AS ENUM('main', 'featured', 'remixer', 'producer', 'writer', 'composer', 'mixer', 'mastering');--> statement-breakpoint
CREATE TYPE "public"."party_kind" AS ENUM('person', 'group', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."release_type" AS ENUM('single', 'ep', 'album', 'compilation');--> statement-breakpoint
CREATE TABLE "credits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"recording_id" uuid,
	"release_id" uuid,
	"party_id" uuid NOT NULL,
	"role" "credit_role" NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"source" text NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" text,
	CONSTRAINT "credits_one_target" CHECK (("credits"."recording_id" IS NULL) <> ("credits"."release_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "import_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"source" text NOT NULL,
	"file_name" text NOT NULL,
	"file_sha256" text NOT NULL,
	"actor_id" text NOT NULL,
	"summary" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "labels" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "parties" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"kind" "party_kind" DEFAULT 'unknown' NOT NULL,
	"display_name" text NOT NULL,
	"match_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recordings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"isrc" text NOT NULL,
	"title" text NOT NULL,
	"version_title" text,
	"duration_ms" integer,
	"genre" text,
	"subgenre" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "release_tracks" (
	"release_id" uuid NOT NULL,
	"recording_id" uuid NOT NULL,
	"disc" integer DEFAULT 1 NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "release_tracks_release_id_disc_position_pk" PRIMARY KEY("release_id","disc","position")
);
--> statement-breakpoint
CREATE TABLE "releases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"label_id" uuid NOT NULL,
	"upc" text NOT NULL,
	"catalog_number" text,
	"title" text NOT NULL,
	"version_title" text,
	"type" "release_type" NOT NULL,
	"release_date" date,
	"genre" text,
	"subgenre" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credits" ADD CONSTRAINT "credits_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credits" ADD CONSTRAINT "credits_recording_id_recordings_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."recordings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credits" ADD CONSTRAINT "credits_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credits" ADD CONSTRAINT "credits_party_id_parties_id_fk" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "labels" ADD CONSTRAINT "labels_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_tracks" ADD CONSTRAINT "release_tracks_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_tracks" ADD CONSTRAINT "release_tracks_recording_id_recordings_id_fk" FOREIGN KEY ("recording_id") REFERENCES "public"."recordings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_label_id_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."labels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credits_recording_party_role_key" ON "credits" USING btree ("recording_id","party_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "credits_release_party_role_key" ON "credits" USING btree ("release_id","party_id","role");--> statement-breakpoint
CREATE INDEX "credits_party_idx" ON "credits" USING btree ("party_id");--> statement-breakpoint
CREATE UNIQUE INDEX "labels_org_name_key" ON "labels" USING btree ("org_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "parties_org_match_key" ON "parties" USING btree ("org_id","match_key");--> statement-breakpoint
CREATE UNIQUE INDEX "recordings_org_isrc_key" ON "recordings" USING btree ("org_id","isrc");--> statement-breakpoint
CREATE INDEX "release_tracks_recording_idx" ON "release_tracks" USING btree ("recording_id");--> statement-breakpoint
CREATE UNIQUE INDEX "releases_org_upc_key" ON "releases" USING btree ("org_id","upc");--> statement-breakpoint
CREATE INDEX "releases_org_date_idx" ON "releases" USING btree ("org_id","release_date");