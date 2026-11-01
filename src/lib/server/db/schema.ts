import { sql } from 'drizzle-orm';
import {
	check,
	date,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
	uuid
} from 'drizzle-orm/pg-core';
import { uuidv7 } from './uuidv7';

/**
 * Phase 0 core: tenancy, membership and the audit trail.
 * Users live in Supabase Auth (auth.users); we reference them by id only so the
 * schema also runs on a plain local Postgres.
 */

export const roleEnum = pgEnum('role', [
	'owner',
	'catalog_manager',
	'rights_admin',
	'viewer',
	'agent'
]);

export const actorKindEnum = pgEnum('actor_kind', ['user', 'agent', 'system']);

export const orgs = pgTable(
	'orgs',
	{
		id: uuid('id').primaryKey().$defaultFn(uuidv7),
		name: text('name').notNull(),
		slug: text('slug').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [uniqueIndex('orgs_slug_key').on(t.slug)]
);

export const memberships = pgTable(
	'memberships',
	{
		orgId: uuid('org_id')
			.notNull()
			.references(() => orgs.id, { onDelete: 'cascade' }),
		userId: uuid('user_id').notNull(),
		role: roleEnum('role').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [primaryKey({ columns: [t.orgId, t.userId] }), index('memberships_user_idx').on(t.userId)]
);

/** Append-only. Written in the same transaction as the change it describes. */
export const auditLog = pgTable(
	'audit_log',
	{
		id: uuid('id').primaryKey().$defaultFn(uuidv7),
		orgId: uuid('org_id')
			.notNull()
			.references(() => orgs.id),
		actorId: text('actor_id').notNull(),
		actorKind: actorKindEnum('actor_kind').notNull(),
		entity: text('entity').notNull(),
		entityId: text('entity_id').notNull(),
		action: text('action').notNull(),
		before: jsonb('before'),
		after: jsonb('after'),
		at: timestamp('at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		index('audit_log_entity_idx').on(t.orgId, t.entity, t.entityId),
		index('audit_log_at_idx').on(t.orgId, t.at)
	]
);

export type Org = typeof orgs.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type AuditEntry = typeof auditLog.$inferSelect;
export type Role = (typeof roleEnum.enumValues)[number];

/* ------------------------------------------------------------------------- */
/* Phase 1: catalog                                                           */
/* ------------------------------------------------------------------------- */

export const partyKindEnum = pgEnum('party_kind', ['person', 'group', 'unknown']);
export const releaseTypeEnum = pgEnum('release_type', ['single', 'ep', 'album', 'compilation']);
export const creditRoleEnum = pgEnum('credit_role', [
	'main',
	'featured',
	'remixer',
	'producer',
	'writer',
	'composer',
	'mixer',
	'mastering'
]);

/** Imprints within the org, e.g. Epsilon Records, diVerse Records. */
export const labels = pgTable(
	'labels',
	{
		id: uuid('id').primaryKey().$defaultFn(uuidv7),
		orgId: uuid('org_id')
			.notNull()
			.references(() => orgs.id),
		name: text('name').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [uniqueIndex('labels_org_name_key').on(t.orgId, t.name)]
);

/** Artists, writers, producers: anyone who can hold a credit. */
export const parties = pgTable(
	'parties',
	{
		id: uuid('id').primaryKey().$defaultFn(uuidv7),
		orgId: uuid('org_id')
			.notNull()
			.references(() => orgs.id),
		kind: partyKindEnum('kind').notNull().default('unknown'),
		displayName: text('display_name').notNull(),
		/** Lowercased, whitespace-collapsed name used to match imports to existing parties. */
		matchKey: text('match_key').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [uniqueIndex('parties_org_match_key').on(t.orgId, t.matchKey)]
);

export const recordings = pgTable(
	'recordings',
	{
		id: uuid('id').primaryKey().$defaultFn(uuidv7),
		orgId: uuid('org_id')
			.notNull()
			.references(() => orgs.id),
		isrc: text('isrc').notNull(),
		title: text('title').notNull(),
		versionTitle: text('version_title'),
		durationMs: integer('duration_ms'),
		genre: text('genre'),
		subgenre: text('subgenre'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [uniqueIndex('recordings_org_isrc_key').on(t.orgId, t.isrc)]
);

export const releases = pgTable(
	'releases',
	{
		id: uuid('id').primaryKey().$defaultFn(uuidv7),
		orgId: uuid('org_id')
			.notNull()
			.references(() => orgs.id),
		labelId: uuid('label_id')
			.notNull()
			.references(() => labels.id),
		upc: text('upc').notNull(),
		catalogNumber: text('catalog_number'),
		title: text('title').notNull(),
		versionTitle: text('version_title'),
		type: releaseTypeEnum('type').notNull(),
		releaseDate: date('release_date'),
		genre: text('genre'),
		subgenre: text('subgenre'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		uniqueIndex('releases_org_upc_key').on(t.orgId, t.upc),
		index('releases_org_date_idx').on(t.orgId, t.releaseDate)
	]
);

export const releaseTracks = pgTable(
	'release_tracks',
	{
		releaseId: uuid('release_id')
			.notNull()
			.references(() => releases.id, { onDelete: 'cascade' }),
		recordingId: uuid('recording_id')
			.notNull()
			.references(() => recordings.id),
		disc: integer('disc').notNull().default(1),
		position: integer('position').notNull()
	},
	(t) => [
		primaryKey({ columns: [t.releaseId, t.disc, t.position] }),
		index('release_tracks_recording_idx').on(t.recordingId)
	]
);

/**
 * Who did what. A credit hangs on a recording or on a release (release artist).
 * Imported credits are approved on import: the distributor already published them.
 */
export const credits = pgTable(
	'credits',
	{
		id: uuid('id').primaryKey().$defaultFn(uuidv7),
		orgId: uuid('org_id')
			.notNull()
			.references(() => orgs.id),
		recordingId: uuid('recording_id').references(() => recordings.id, { onDelete: 'cascade' }),
		releaseId: uuid('release_id').references(() => releases.id, { onDelete: 'cascade' }),
		partyId: uuid('party_id')
			.notNull()
			.references(() => parties.id),
		role: creditRoleEnum('role').notNull(),
		position: integer('position').notNull().default(0),
		source: text('source').notNull(),
		approvedAt: timestamp('approved_at', { withTimezone: true }),
		approvedBy: text('approved_by')
	},
	(t) => [
		uniqueIndex('credits_recording_party_role_key').on(t.recordingId, t.partyId, t.role),
		uniqueIndex('credits_release_party_role_key').on(t.releaseId, t.partyId, t.role),
		index('credits_party_idx').on(t.partyId),
		check('credits_one_target', sql`(${t.recordingId} IS NULL) <> (${t.releaseId} IS NULL)`)
	]
);

export const importRuns = pgTable('import_runs', {
	id: uuid('id').primaryKey().$defaultFn(uuidv7),
	orgId: uuid('org_id')
		.notNull()
		.references(() => orgs.id),
	source: text('source').notNull(),
	fileName: text('file_name').notNull(),
	fileSha256: text('file_sha256').notNull(),
	actorId: text('actor_id').notNull(),
	summary: jsonb('summary').notNull(),
	createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
});

export type Label = typeof labels.$inferSelect;
export type Party = typeof parties.$inferSelect;
export type Recording = typeof recordings.$inferSelect;
export type Release = typeof releases.$inferSelect;
export type Credit = typeof credits.$inferSelect;
export type CreditRole = (typeof creditRoleEnum.enumValues)[number];
