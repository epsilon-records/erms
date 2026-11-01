-- Every link between catalog rows now carries org_id, so the database itself refuses
-- a track, credit or label link that points into another org.

-- 1. (org_id, id) keys that the composite foreign keys point at.
ALTER TABLE "labels" ADD CONSTRAINT "labels_org_id_key" UNIQUE("org_id","id");--> statement-breakpoint
ALTER TABLE "parties" ADD CONSTRAINT "parties_org_id_key" UNIQUE("org_id","id");--> statement-breakpoint
ALTER TABLE "recordings" ADD CONSTRAINT "recordings_org_id_key" UNIQUE("org_id","id");--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_org_id_key" UNIQUE("org_id","id");--> statement-breakpoint

-- 2. release_tracks gets org_id, filled from its release.
ALTER TABLE "release_tracks" ADD COLUMN "org_id" uuid;--> statement-breakpoint
UPDATE "release_tracks" rt SET "org_id" = r."org_id" FROM "releases" r WHERE r."id" = rt."release_id";--> statement-breakpoint
ALTER TABLE "release_tracks" ALTER COLUMN "org_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "release_tracks" ADD CONSTRAINT "release_tracks_org_id_orgs_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- 3. Swap single-column foreign keys for same-org ones.
ALTER TABLE "releases" DROP CONSTRAINT "releases_label_id_labels_id_fk";--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_label_same_org_fk" FOREIGN KEY ("org_id","label_id") REFERENCES "public"."labels"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_tracks" DROP CONSTRAINT "release_tracks_release_id_releases_id_fk";--> statement-breakpoint
ALTER TABLE "release_tracks" DROP CONSTRAINT "release_tracks_recording_id_recordings_id_fk";--> statement-breakpoint
ALTER TABLE "release_tracks" ADD CONSTRAINT "release_tracks_release_same_org_fk" FOREIGN KEY ("org_id","release_id") REFERENCES "public"."releases"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_tracks" ADD CONSTRAINT "release_tracks_recording_same_org_fk" FOREIGN KEY ("org_id","recording_id") REFERENCES "public"."recordings"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credits" DROP CONSTRAINT "credits_recording_id_recordings_id_fk";--> statement-breakpoint
ALTER TABLE "credits" DROP CONSTRAINT "credits_release_id_releases_id_fk";--> statement-breakpoint
ALTER TABLE "credits" DROP CONSTRAINT "credits_party_id_parties_id_fk";--> statement-breakpoint
ALTER TABLE "credits" ADD CONSTRAINT "credits_recording_same_org_fk" FOREIGN KEY ("org_id","recording_id") REFERENCES "public"."recordings"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credits" ADD CONSTRAINT "credits_release_same_org_fk" FOREIGN KEY ("org_id","release_id") REFERENCES "public"."releases"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credits" ADD CONSTRAINT "credits_party_same_org_fk" FOREIGN KEY ("org_id","party_id") REFERENCES "public"."parties"("org_id","id") ON DELETE no action ON UPDATE no action;
