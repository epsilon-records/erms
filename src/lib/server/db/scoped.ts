import { sql } from 'drizzle-orm';
import type { Database } from '../audit';

/** The role every app query runs as. It has no login and cannot bypass RLS. */
export const APP_ROLE = 'labelkit_app';

/**
 * Each role's name before migration 0028 renamed it from erms_* to labelkit_*. Switching to a
 * role picks the new name when it exists and the old one otherwise, so the rename and the
 * deploy can land in either order. Remove the fallback once 0028 is on production.
 */
const LEGACY_NAMES = {
	labelkit_app: 'erms_app',
	labelkit_auth_email: 'erms_auth_email',
	labelkit_metrics_ingest: 'erms_metrics_ingest',
	labelkit_metrics_prune: 'erms_metrics_prune'
} as const;
type RoleName = keyof typeof LEGACY_NAMES;

/** The role to switch to: `name` if the database has it, else its pre-0028 name. */
function roleName(name: RoleName) {
	const legacy = LEGACY_NAMES[name];
	return sql`(select coalesce(max(rolname) filter (where rolname = ${name}), ${legacy}) from pg_roles where rolname in (${name}, ${legacy}))`;
}

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
			sql`select set_config('role', ${roleName(APP_ROLE)}, true), set_config('request.jwt.claim.sub', ${userId}, true)`
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
export const AUTH_EMAIL_ROLE = 'labelkit_auth_email';
export async function setAuthEmailRole(tx: Database) {
	await tx.execute(
		sql`select set_config('role', ${roleName(AUTH_EMAIL_ROLE)}, true), set_config('statement_timeout', '1000ms', true)`
	);
}

export type MetricsRole = 'labelkit_metrics_ingest' | 'labelkit_metrics_prune';
/** Called only inside a reserved transaction owned by client.ts. No JWT identity is set. */
export async function setMetricsRole(tx: Database, role: MetricsRole) {
	await tx.execute(
		sql`select set_config('role', ${roleName(role)}, true), set_config('lock_timeout', '100ms', true), set_config('statement_timeout', '250ms', true)`
	);
}
