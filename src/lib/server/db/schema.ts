import {
	index,
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
