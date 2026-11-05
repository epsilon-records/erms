import { sql } from 'drizzle-orm';
import {
	bigint,
	boolean,
	check,
	date,
	foreignKey,
	index,
	integer,
	jsonb,
	numeric,
	pgEnum,
	pgTable,
	primaryKey,
	text,
	timestamp,
	unique,
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
	(t) => [
		uniqueIndex('labels_org_name_key').on(t.orgId, t.name),
		// Target for same-org foreign keys (see releases).
		unique('labels_org_id_key').on(t.orgId, t.id)
	]
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
	(t) => [
		uniqueIndex('parties_org_match_key').on(t.orgId, t.matchKey),
		unique('parties_org_id_key').on(t.orgId, t.id)
	]
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
	(t) => [
		uniqueIndex('recordings_org_isrc_key').on(t.orgId, t.isrc),
		unique('recordings_org_id_key').on(t.orgId, t.id),
		// Same rules as identifiers.ts; the app validates first, the database is the backstop.
		check('recordings_isrc_format', sql`${t.isrc} ~ '^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$'`),
		check('recordings_duration_positive', sql`${t.durationMs} IS NULL OR ${t.durationMs} > 0`)
	]
);

export const releases = pgTable(
	'releases',
	{
		id: uuid('id').primaryKey().$defaultFn(uuidv7),
		orgId: uuid('org_id')
			.notNull()
			.references(() => orgs.id),
		labelId: uuid('label_id').notNull(),
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
		index('releases_org_date_idx').on(t.orgId, t.releaseDate),
		unique('releases_org_id_key').on(t.orgId, t.id),
		check('releases_upc_format', sql`${t.upc} ~ '^[0-9]{12,13}$'`),
		// Every link carries org_id so the database refuses links across orgs.
		foreignKey({
			name: 'releases_label_same_org_fk',
			columns: [t.orgId, t.labelId],
			foreignColumns: [labels.orgId, labels.id]
		})
	]
);

export const releaseTracks = pgTable(
	'release_tracks',
	{
		orgId: uuid('org_id')
			.notNull()
			.references(() => orgs.id),
		releaseId: uuid('release_id').notNull(),
		recordingId: uuid('recording_id').notNull(),
		disc: integer('disc').notNull().default(1),
		position: integer('position').notNull()
	},
	(t) => [
		primaryKey({ columns: [t.releaseId, t.disc, t.position] }),
		index('release_tracks_recording_idx').on(t.recordingId),
		check('release_tracks_position_positive', sql`${t.position} > 0 AND ${t.disc} > 0`),
		foreignKey({
			name: 'release_tracks_release_same_org_fk',
			columns: [t.orgId, t.releaseId],
			foreignColumns: [releases.orgId, releases.id]
		}).onDelete('cascade'),
		foreignKey({
			name: 'release_tracks_recording_same_org_fk',
			columns: [t.orgId, t.recordingId],
			foreignColumns: [recordings.orgId, recordings.id]
		})
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
		recordingId: uuid('recording_id'),
		releaseId: uuid('release_id'),
		partyId: uuid('party_id').notNull(),
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
		index('credits_org_recording_idx').on(t.orgId, t.recordingId),
		index('credits_org_release_idx').on(t.orgId, t.releaseId),
		check('credits_position_nonnegative', sql`${t.position} >= 0`),
		check('credits_one_target', sql`(${t.recordingId} IS NULL) <> (${t.releaseId} IS NULL)`),
		foreignKey({
			name: 'credits_recording_same_org_fk',
			columns: [t.orgId, t.recordingId],
			foreignColumns: [recordings.orgId, recordings.id]
		}).onDelete('cascade'),
		foreignKey({
			name: 'credits_release_same_org_fk',
			columns: [t.orgId, t.releaseId],
			foreignColumns: [releases.orgId, releases.id]
		}).onDelete('cascade'),
		foreignKey({
			name: 'credits_party_same_org_fk',
			columns: [t.orgId, t.partyId],
			foreignColumns: [parties.orgId, parties.id]
		})
	]
);

export const importRuns = pgTable(
	'import_runs',
	{
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
	},
	(t) => [
		index('import_runs_org_created_idx').on(t.orgId, t.createdAt),
		check('import_runs_sha256_format', sql`${t.fileSha256} ~ '^[0-9a-f]{64}$'`)
	]
);

export type Label = typeof labels.$inferSelect;
export type Party = typeof parties.$inferSelect;
export type Recording = typeof recordings.$inferSelect;
export type Release = typeof releases.$inferSelect;
export type Credit = typeof credits.$inferSelect;
export type CreditRole = (typeof creditRoleEnum.enumValues)[number];

/* ------------------------------------------------------------------------- */
/* Phase 2: rights and contracts                                              */
/* ------------------------------------------------------------------------- */

export const rightTypeEnum = pgEnum('right_type', ['master', 'publishing']);
export const writerRoleEnum = pgEnum('writer_role', [
	'composer',
	'lyricist',
	'composer_lyricist',
	'arranger'
]);
export const agreementKindEnum = pgEnum('agreement_kind', [
	'recording',
	'license',
	'publishing',
	'remix',
	'distribution',
	'other'
]);
export const agreementStatusEnum = pgEnum('agreement_status', [
	'draft',
	'active',
	'expired',
	'terminated'
]);
/** What a consent covers, and what authorize() is asked about. */
export const processingPurposeEnum = pgEnum('processing_purpose', [
	'analysis',
	'transcode',
	'stem_separation',
	'mastering',
	'voice',
	'generation'
]);

/** A territory: 'WW' for worldwide or an ISO 3166-1 alpha-2 code. */
const territoryCheck = (col: unknown) => sql`${col} ~ '^(WW|[A-Z]{2})$'`;
/** Percentages are stored with four decimals, e.g. 33.3333. */
const percent = (name: string) => numeric(name, { precision: 7, scale: 4 });

/** A musical work. Recordings embody it; writers wrote it; publishers own it. */
export const compositions = pgTable(
	'compositions',
	{
		id: uuid('id').primaryKey().$defaultFn(uuidv7),
		orgId: uuid('org_id')
			.notNull()
			.references(() => orgs.id),
		title: text('title').notNull(),
		/** Stored without separators: T1234567890. */
		iswc: text('iswc'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		uniqueIndex('compositions_org_iswc_key').on(t.orgId, t.iswc),
		unique('compositions_org_id_key').on(t.orgId, t.id),
		check('compositions_iswc_format', sql`${t.iswc} IS NULL OR ${t.iswc} ~ '^T[0-9]{10}$'`)
	]
);

export const recordingCompositions = pgTable(
	'recording_compositions',
	{
		orgId: uuid('org_id')
			.notNull()
			.references(() => orgs.id),
		recordingId: uuid('recording_id').notNull(),
		compositionId: uuid('composition_id').notNull()
	},
	(t) => [
		primaryKey({ columns: [t.recordingId, t.compositionId] }),
		index('recording_compositions_composition_idx').on(t.compositionId),
		foreignKey({
			name: 'recording_compositions_recording_same_org_fk',
			columns: [t.orgId, t.recordingId],
			foreignColumns: [recordings.orgId, recordings.id]
		}).onDelete('cascade'),
		foreignKey({
			name: 'recording_compositions_composition_same_org_fk',
			columns: [t.orgId, t.compositionId],
			foreignColumns: [compositions.orgId, compositions.id]
		}).onDelete('cascade')
	]
);

/** Writer splits on a composition. Per composition they total 100 or are absent. */
export const compositionWriters = pgTable(
	'composition_writers',
	{
		id: uuid('id').primaryKey().$defaultFn(uuidv7),
		orgId: uuid('org_id')
			.notNull()
			.references(() => orgs.id),
		compositionId: uuid('composition_id').notNull(),
		partyId: uuid('party_id').notNull(),
		role: writerRoleEnum('role').notNull(),
		share: percent('share').notNull()
	},
	(t) => [
		uniqueIndex('composition_writers_party_role_key').on(t.compositionId, t.partyId, t.role),
		check('composition_writers_share_range', sql`${t.share} > 0 AND ${t.share} <= 100`),
		foreignKey({
			name: 'composition_writers_composition_same_org_fk',
			columns: [t.orgId, t.compositionId],
			foreignColumns: [compositions.orgId, compositions.id]
		}).onDelete('cascade'),
		foreignKey({
			name: 'composition_writers_party_same_org_fk',
			columns: [t.orgId, t.partyId],
			foreignColumns: [parties.orgId, parties.id]
		})
	]
);

/** A contract with a counterparty, signed on behalf of one of the org's labels. */
export const agreements = pgTable(
	'agreements',
	{
		id: uuid('id').primaryKey().$defaultFn(uuidv7),
		orgId: uuid('org_id')
			.notNull()
			.references(() => orgs.id),
		labelId: uuid('label_id').notNull(),
		counterpartyId: uuid('counterparty_id').notNull(),
		kind: agreementKindEnum('kind').notNull(),
		title: text('title').notNull(),
		status: agreementStatusEnum('status').notNull().default('draft'),
		signedOn: date('signed_on'),
		startsOn: date('starts_on'),
		endsOn: date('ends_on'),
		territory: text('territory').notNull().default('WW'),
		/** Signed copy in Supabase Storage, with its checksum taken on upload. */
		documentPath: text('document_path'),
		documentSha256: text('document_sha256'),
		notes: text('notes'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		index('agreements_org_counterparty_idx').on(t.orgId, t.counterpartyId),
		unique('agreements_org_id_key').on(t.orgId, t.id),
		check('agreements_territory_format', territoryCheck(t.territory)),
		check(
			'agreements_term_order',
			sql`${t.endsOn} IS NULL OR ${t.startsOn} IS NULL OR ${t.endsOn} >= ${t.startsOn}`
		),
		check(
			'agreements_document_pair',
			sql`(${t.documentPath} IS NULL) = (${t.documentSha256} IS NULL) AND (${t.documentSha256} IS NULL OR ${t.documentSha256} ~ '^[0-9a-f]{64}$')`
		),
		foreignKey({
			name: 'agreements_label_same_org_fk',
			columns: [t.orgId, t.labelId],
			foreignColumns: [labels.orgId, labels.id]
		}),
		foreignKey({
			name: 'agreements_counterparty_same_org_fk',
			columns: [t.orgId, t.counterpartyId],
			foreignColumns: [parties.orgId, parties.id]
		})
	]
);

/**
 * Ownership. Master shares hang on a recording, publishing shares on a composition.
 * The holder is one of the org's labels or a party (artist, publisher, another label).
 * Per target, right and territory the shares total exactly 100, checked at commit.
 */
export const rightsShares = pgTable(
	'rights_shares',
	{
		id: uuid('id').primaryKey().$defaultFn(uuidv7),
		orgId: uuid('org_id')
			.notNull()
			.references(() => orgs.id),
		right: rightTypeEnum('right').notNull(),
		recordingId: uuid('recording_id'),
		compositionId: uuid('composition_id'),
		holderLabelId: uuid('holder_label_id'),
		holderPartyId: uuid('holder_party_id'),
		territory: text('territory').notNull().default('WW'),
		share: percent('share').notNull(),
		agreementId: uuid('agreement_id'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		index('rights_shares_org_recording_idx').on(t.orgId, t.recordingId),
		index('rights_shares_org_composition_idx').on(t.orgId, t.compositionId),
		// One row per target, right, territory and holder: an expression index in 0010.
		check(
			'rights_shares_target_matches_right',
			sql`(${t.right} = 'master' AND ${t.recordingId} IS NOT NULL AND ${t.compositionId} IS NULL) OR (${t.right} = 'publishing' AND ${t.compositionId} IS NOT NULL AND ${t.recordingId} IS NULL)`
		),
		check(
			'rights_shares_one_holder',
			sql`(${t.holderLabelId} IS NULL) <> (${t.holderPartyId} IS NULL)`
		),
		check('rights_shares_share_range', sql`${t.share} > 0 AND ${t.share} <= 100`),
		check('rights_shares_territory_format', territoryCheck(t.territory)),
		foreignKey({
			name: 'rights_shares_recording_same_org_fk',
			columns: [t.orgId, t.recordingId],
			foreignColumns: [recordings.orgId, recordings.id]
		}).onDelete('cascade'),
		foreignKey({
			name: 'rights_shares_composition_same_org_fk',
			columns: [t.orgId, t.compositionId],
			foreignColumns: [compositions.orgId, compositions.id]
		}).onDelete('cascade'),
		foreignKey({
			name: 'rights_shares_label_same_org_fk',
			columns: [t.orgId, t.holderLabelId],
			foreignColumns: [labels.orgId, labels.id]
		}),
		foreignKey({
			name: 'rights_shares_party_same_org_fk',
			columns: [t.orgId, t.holderPartyId],
			foreignColumns: [parties.orgId, parties.id]
		}),
		foreignKey({
			name: 'rights_shares_agreement_same_org_fk',
			columns: [t.orgId, t.agreementId],
			foreignColumns: [agreements.orgId, agreements.id]
		})
	]
);

/**
 * Permission from a party (usually an artist) for a processing purpose: for one
 * recording, or for every recording that credits them when recording_id is null.
 */
export const consents = pgTable(
	'consents',
	{
		id: uuid('id').primaryKey().$defaultFn(uuidv7),
		orgId: uuid('org_id')
			.notNull()
			.references(() => orgs.id),
		partyId: uuid('party_id').notNull(),
		purpose: processingPurposeEnum('purpose').notNull(),
		recordingId: uuid('recording_id'),
		agreementId: uuid('agreement_id'),
		grantedOn: date('granted_on').notNull(),
		expiresOn: date('expires_on'),
		revokedAt: timestamp('revoked_at', { withTimezone: true }),
		notes: text('notes'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		index('consents_org_party_idx').on(t.orgId, t.partyId),
		check('consents_term_order', sql`${t.expiresOn} IS NULL OR ${t.expiresOn} >= ${t.grantedOn}`),
		foreignKey({
			name: 'consents_party_same_org_fk',
			columns: [t.orgId, t.partyId],
			foreignColumns: [parties.orgId, parties.id]
		}),
		foreignKey({
			name: 'consents_recording_same_org_fk',
			columns: [t.orgId, t.recordingId],
			foreignColumns: [recordings.orgId, recordings.id]
		}).onDelete('cascade'),
		foreignKey({
			name: 'consents_agreement_same_org_fk',
			columns: [t.orgId, t.agreementId],
			foreignColumns: [agreements.orgId, agreements.id]
		})
	]
);

/** Every authorize() verdict, kept as evidence. AudioKit jobs reference one by id. */
export const authorizationDecisions = pgTable(
	'authorization_decisions',
	{
		id: uuid('id').primaryKey().$defaultFn(uuidv7),
		orgId: uuid('org_id')
			.notNull()
			.references(() => orgs.id),
		recordingId: uuid('recording_id').notNull(),
		purpose: processingPurposeEnum('purpose').notNull(),
		allowed: boolean('allowed').notNull(),
		/** Stable codes, e.g. master_incomplete, consent_missing. */
		reasons: jsonb('reasons').notNull(),
		/** The facts the verdict was based on: shares, consents used. */
		basis: jsonb('basis').notNull(),
		actorId: text('actor_id').notNull(),
		actorKind: actorKindEnum('actor_kind').notNull(),
		decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow()
	},
	(t) => [
		index('authorization_decisions_org_recording_idx').on(t.orgId, t.recordingId, t.decidedAt),
		foreignKey({
			name: 'authorization_decisions_recording_same_org_fk',
			columns: [t.orgId, t.recordingId],
			foreignColumns: [recordings.orgId, recordings.id]
		}).onDelete('cascade')
	]
);

export type Composition = typeof compositions.$inferSelect;
export type CompositionWriter = typeof compositionWriters.$inferSelect;
export type Agreement = typeof agreements.$inferSelect;
export type RightsShare = typeof rightsShares.$inferSelect;
export type Consent = typeof consents.$inferSelect;
export type AuthorizationDecision = typeof authorizationDecisions.$inferSelect;
export type ProcessingPurpose = (typeof processingPurposeEnum.enumValues)[number];

/* ------------------------------------------------------------------------- */
/* Phase 3: master files (Cloudflare R2, ERMS decision 0011)                  */
/* ------------------------------------------------------------------------- */

/**
 * pending: URLs signed, upload not confirmed. ready: object checked and recorded.
 * rejected: the uploaded object failed a check and was deleted. aborted: cancelled.
 */
export const masterStatusEnum = pgEnum('master_status', [
	'pending',
	'ready',
	'rejected',
	'aborted'
]);

/**
 * A master file for a recording. The bytes live in R2 under an org-scoped key;
 * this row is ERMS's record of it. Supabase RLS doesn't reach R2, so ERMS only signs
 * URLs for keys under the signed-in user's org, and the key check below is the backstop.
 */
export const masters = pgTable(
	'masters',
	{
		id: uuid('id').primaryKey().$defaultFn(uuidv7),
		orgId: uuid('org_id')
			.notNull()
			.references(() => orgs.id),
		recordingId: uuid('recording_id').notNull(),
		/** orgs/{org_id}/recordings/{recording_id}/masters/{id}.wav */
		objectKey: text('object_key').notNull(),
		format: text('format').notNull().default('wav'),
		/** Declared before upload, confirmed against R2 before the master is ready. */
		sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
		/** Hex SHA-256 of the file, computed in the browser while uploading. */
		sha256: text('sha256'),
		fileName: text('file_name').notNull(),
		status: masterStatusEnum('status').notNull().default('pending'),
		/** R2 multipart upload id while a multipart upload is in progress. */
		uploadId: text('upload_id'),
		uploadedBy: text('uploaded_by').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		completedAt: timestamp('completed_at', { withTimezone: true })
	},
	(t) => [
		uniqueIndex('masters_object_key_key').on(t.objectKey),
		index('masters_org_recording_idx').on(t.orgId, t.recordingId, t.createdAt),
		check(
			'masters_key_in_org',
			sql`${t.objectKey} = 'orgs/' || ${t.orgId}::text || '/recordings/' || ${t.recordingId}::text || '/masters/' || ${t.id}::text || '.wav'`
		),
		check('masters_format_wav', sql`${t.format} = 'wav'`),
		check('masters_size_positive', sql`${t.sizeBytes} > 0`),
		check('masters_sha256_format', sql`${t.sha256} IS NULL OR ${t.sha256} ~ '^[0-9a-f]{64}$'`),
		check(
			'masters_ready_complete',
			sql`${t.status} <> 'ready' OR (${t.sha256} IS NOT NULL AND ${t.completedAt} IS NOT NULL)`
		),
		foreignKey({
			name: 'masters_recording_same_org_fk',
			columns: [t.orgId, t.recordingId],
			foreignColumns: [recordings.orgId, recordings.id]
		})
	]
);

export type Master = typeof masters.$inferSelect;
export type MasterStatus = (typeof masterStatusEnum.enumValues)[number];

/* ------------------------------------------------------------------------- */
/* Phase 4: AudioKit jobs                                                     */
/* ------------------------------------------------------------------------- */

/**
 * queued: waiting to be submitted. submitted: sent to AudioKit. succeeded/failed/canceled: final.
 */
export const audiokitJobStatusEnum = pgEnum('audiokit_job_status', [
	'queued',
	'submitted',
	'succeeded',
	'failed',
	'canceled'
]);

/**
 * Jobs submitted to AudioKit for audio processing. One row per job; the worker polls for
 * queued jobs, issues presigned URLs, submits to AudioKit, and stores the provider_job_id.
 * Webhooks from AudioKit update the row with results or errors.
 */
export const audiokitJobs = pgTable(
	'audiokit_jobs',
	{
		/** ERMS's job id, used as the idempotency key in AudioKit's API. */
		id: uuid('id').primaryKey().$defaultFn(uuidv7),
		orgId: uuid('org_id')
			.notNull()
			.references(() => orgs.id),
		recordingId: uuid('recording_id').notNull(),
		masterId: uuid('master_id').notNull(),
		/** The AudioKit operation to run (analyze, transcode, etc). */
		operation: text('operation').notNull(),
		/** Operation parameters as JSON (null for operations with no params). */
		params: jsonb('params'),
		/** AudioKit's provider_job_id, returned when the job is submitted. */
		providerJobId: uuid('provider_job_id'),
		status: audiokitJobStatusEnum('status').notNull().default('queued'),
		/** The result from AudioKit (for succeeded jobs). */
		result: jsonb('result'),
		/** The error from AudioKit (for failed jobs). */
		error: jsonb('error'),
		/** Authorization decision id that allowed this job. */
		authorizationId: uuid('authorization_id'),
		/** Who requested the job. */
		requestedBy: text('requested_by').notNull(),
		requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
		/** When the job was submitted to AudioKit. */
		submittedAt: timestamp('submitted_at', { withTimezone: true }),
		/** When AudioKit reported the job finished (succeeded, failed or canceled). */
		finishedAt: timestamp('finished_at', { withTimezone: true }),
		/** Number of times the worker has tried to submit this job. */
		attempts: integer('attempts').notNull().default(0),
		/** When the worker last tried to submit (used to avoid retrying too fast). */
		lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true })
	},
	(t) => [
		index('audiokit_jobs_org_recording_idx').on(t.orgId, t.recordingId, t.requestedAt),
		index('audiokit_jobs_master_idx').on(t.masterId),
		index('audiokit_jobs_status_idx').on(t.status, t.requestedAt),
		index('audiokit_jobs_provider_idx').on(t.providerJobId),
		check(
			'audiokit_jobs_submitted_complete',
			sql`${t.status} = 'queued' OR (${t.providerJobId} IS NOT NULL AND ${t.submittedAt} IS NOT NULL)`
		),
		check(
			'audiokit_jobs_finished_complete',
			sql`${t.status} NOT IN ('succeeded', 'failed', 'canceled') OR ${t.finishedAt} IS NOT NULL`
		),
		check(
			'audiokit_jobs_result_on_success',
			sql`${t.status} <> 'succeeded' OR ${t.result} IS NOT NULL`
		),
		check('audiokit_jobs_error_on_failure', sql`${t.status} <> 'failed' OR ${t.error} IS NOT NULL`),
		foreignKey({
			name: 'audiokit_jobs_recording_same_org_fk',
			columns: [t.orgId, t.recordingId],
			foreignColumns: [recordings.orgId, recordings.id]
		}),
		foreignKey({
			name: 'audiokit_jobs_master_fk',
			columns: [t.masterId],
			foreignColumns: [masters.id]
		}),
		foreignKey({
			name: 'audiokit_jobs_authorization_same_org_fk',
			columns: [t.orgId, t.authorizationId],
			foreignColumns: [authorizationDecisions.orgId, authorizationDecisions.id]
		})
	]
);

export type AudiokitJob = typeof audiokitJobs.$inferSelect;
export type AudiokitJobStatus = (typeof audiokitJobStatusEnum.enumValues)[number];
