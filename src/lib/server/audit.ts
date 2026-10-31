import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type * as schema from './db/schema';
import { auditLog } from './db/schema';

/** Any Drizzle Postgres database on our schema (postgres-js in prod, PGlite in tests). */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export type Actor = {
	id: string;
	kind: 'user' | 'agent' | 'system';
};

export type AuditRecord = {
	entity: string;
	entityId: string;
	action: string;
	before?: unknown;
	after?: unknown;
};

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export type AuditFn = (record: AuditRecord) => Promise<void>;

/**
 * Run a write and its audit entries in one transaction.
 * If the callback throws, the change and its audit entries roll back together.
 * If a write records no audit entry, the transaction is rejected: every change
 * that goes through this helper must leave a trace.
 */
export async function withAudit<T>(
	db: Database,
	ctx: { orgId: string; actor: Actor },
	fn: (tx: Tx, audit: AuditFn) => Promise<T>
): Promise<T> {
	return db.transaction(async (tx) => {
		let recorded = 0;
		const audit: AuditFn = async (r) => {
			await tx.insert(auditLog).values({
				orgId: ctx.orgId,
				actorId: ctx.actor.id,
				actorKind: ctx.actor.kind,
				entity: r.entity,
				entityId: r.entityId,
				action: r.action,
				before: r.before ?? null,
				after: r.after ?? null
			});
			recorded++;
		};
		const result = await fn(tx, audit);
		if (recorded === 0) {
			throw new Error('withAudit: write completed without an audit entry');
		}
		return result;
	});
}
