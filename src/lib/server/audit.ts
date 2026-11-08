import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type * as schema from './db/schema';
import { auditLog } from './db/schema';

/** Any Drizzle Postgres database on our schema (postgres-js, in production and in tests). */
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

export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Record one entry, or many in a single insert (bulk operations such as imports). */
export type AuditFn = (record: AuditRecord | AuditRecord[]) => Promise<void>;

/**
 * Throw from inside withAudit when a write turns out to change nothing (e.g. a form
 * saved as-is). The transaction rolls back and withAudit returns `value`.
 */
export class NoChange<T> extends Error {
	constructor(readonly value: T) {
		super('no change');
	}
}

/**
 * Run a write and its audit entries in one transaction.
 * If the callback throws, the change and its audit entries roll back together.
 * If a write records no audit entry, the transaction is rejected: every change
 * that goes through this helper must leave a trace.
 */
/**
 * Record a machine (system-actor) entry inside an existing transaction. The
 * webhook, worker and reconcile routes use this: they write without a user, but
 * every job status or result change still needs a trace (decision 0014).
 */
export async function recordSystemAudit(
	tx: Tx,
	record: AuditRecord & { orgId: string; actorId?: string }
): Promise<void> {
	await tx.insert(auditLog).values({
		orgId: record.orgId,
		actorId: record.actorId ?? 'system:audiokit',
		actorKind: 'system',
		entity: record.entity,
		entityId: record.entityId,
		action: record.action,
		before: record.before ?? null,
		after: record.after ?? null
	});
}

export async function withAudit<T>(
	db: Database,
	ctx: { orgId: string; actor: Actor },
	fn: (tx: Tx, audit: AuditFn) => Promise<T>
): Promise<T> {
	try {
		return await runAudited(db, ctx, fn);
	} catch (e) {
		if (e instanceof NoChange) return e.value as T;
		throw e;
	}
}

function runAudited<T>(
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
