import { sql } from 'drizzle-orm';
import type { Database } from '../audit';

/** The role every app query runs as. It has no login and cannot bypass RLS. */
export const APP_ROLE = 'erms_app';

export type Scoped = <T>(fn: (tx: Database) => Promise<T>) => Promise<T>;

/**
 * Run `fn` in one transaction as `erms_app` on behalf of `userId`.
 *
 * Both settings are transaction-local, so they end with the transaction and never
 * leak to the next request on a pooled connection. RLS policies read the user id
 * through app.current_user_id(), the same way they do for Supabase's own API.
 */
export function asUser<T>(db: Database, userId: string, fn: (tx: Database) => Promise<T>) {
	return db.transaction(async (tx) => {
		await tx.execute(
			sql`select set_config('role', ${APP_ROLE}, true), set_config('request.jwt.claim.sub', ${userId}, true)`
		);
		return fn(tx);
	});
}

/** A request-bound runner: every call is its own transaction as this user. */
export function scopedTo(db: Database, userId: string): Scoped {
	return (fn) => asUser(db, userId, fn);
}
