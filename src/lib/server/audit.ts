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

/** Record one entry, or many in a single insert (bulk operations such as imports). */
export type AuditFn = (record: AuditRecord | AuditRecord[]) => Promise<void>;

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
		const audit: AuditFn = async (input) => {
			const records = Array.isArray(input) ? input : [input];
			for (let i = 0; i < records.length; i += 500) {
				await tx.insert(auditLog).values(
					records.slice(i, i + 500).map((r) => ({
						orgId: ctx.orgId,
						actorId: ctx.actor.id,
						actorKind: ctx.actor.kind,
						entity: r.entity,
						entityId: r.entityId,
						action: r.action,
						before: r.before ?? null,
						after: r.after ?? null
					}))
				);
			}
			recorded += records.length;
		};
		const result = await fn(tx, audit);
		if (recorded === 0) {
			throw new Error('withAudit: write completed without an audit entry');
		}
		return result;
	});
}
