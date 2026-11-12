import { sql } from 'drizzle-orm';
import type { Database } from '../audit';

/** The role every app query runs as. It has no login and cannot bypass RLS. */
export const APP_ROLE = 'labelkit_app';

/**
 * The same role's name before migration 0028 renamed it. A transaction uses APP_ROLE when it
 * exists and this one otherwise, so the rename and the deploy can land in either order.
 * Remove the fallback once 0028 is on production.
 */
export const LEGACY_APP_ROLE = 'erms_app';

export type Scoped = <T>(fn: (tx: Database) => Promise<T>) => Promise<T>;

/**
 * Run `fn` in one transaction as `labelkit_app` on behalf of `userId`.
 *
 * Both settings are transaction-local, so they end with the transaction and never
 * leak to the next request on a pooled connection. RLS policies read the user id
 * through app.current_user_id(), the same way they do for Supabase's own API.
 */
export function asUser<T>(db: Database, userId: string, fn: (tx: Database) => Promise<T>) {
	return db.transaction(async (tx) => {
		await tx.execute(
			sql`select set_config('role', (select coalesce(max(rolname) filter (where rolname = ${APP_ROLE}), ${LEGACY_APP_ROLE}) from pg_roles where rolname in (${APP_ROLE}, ${LEGACY_APP_ROLE})), true), set_config('request.jwt.claim.sub', ${userId}, true)`
		);
		return fn(tx);
	});
}

/** A request-bound runner: every call is its own transaction as this user. */
export function scopedTo(db: Database, userId: string): Scoped {
	return (fn) => asUser(db, userId, fn);
}

/**
 * The Send Email auth hook's role (EPSILON-147, migration 0025): EXECUTE on
 * app_auth_email.member_org_ids() and nothing else. No JWT identity is set. Called only inside a
 * transaction owned by client.ts, after the route has verified the hook's signature.
 */
export const AUTH_EMAIL_ROLE = 'erms_auth_email';
export async function setAuthEmailRole(tx: Database) {
	await tx.execute(
		sql`select set_config('role', ${AUTH_EMAIL_ROLE}, true), set_config('statement_timeout', '1000ms', true)`
	);
}

export type MetricsRole = 'erms_metrics_ingest' | 'erms_metrics_prune';
/** Called only inside a reserved transaction owned by client.ts. No JWT identity is set. */
export async function setMetricsRole(tx: Database, role: MetricsRole) {
	await tx.execute(
		sql`select set_config('role', ${role}, true), set_config('lock_timeout', '100ms', true), set_config('statement_timeout', '250ms', true)`
	);
}
