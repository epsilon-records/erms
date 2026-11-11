import { DATABASE_URL } from '$app/env/private';
import { createDb, declareParams, schema } from './index';

let instance: ReturnType<typeof createDb> | undefined;

/** Lazily created so `vite build` never opens a connection. */
export function db() {
	instance ??= createDb(DATABASE_URL);
	return instance;
}

/**
 * The Send Email auth hook's runner (EPSILON-147): each call is one transaction as erms_auth_email,
 * which can only read the org ids of one account through app_auth_email.member_org_ids(). The hook
 * has no signed-in user, so it cannot run as erms_app, and it never gets the owner connection.
 */
export function authEmailRunner(): Scoped {
	return (fn) =>
		db().transaction(async (tx) => {
			await setAuthEmailRole(tx);
			return fn(tx);
		});
}

// Separate small pool: no catalogue workload can queue anonymous metrics behind product queries.
// At most two ingest + one maintenance callers reach this pool; connection setup times out in 1s.
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { setAuthEmailRole, setMetricsRole, type MetricsRole, type Scoped } from './scoped';
let metricsDatabase: ReturnType<typeof createDb> | undefined;
let metricsActive = 0;
export function metricsRunner(role: MetricsRole): Scoped {
	return async (fn) => {
		if (metricsActive >= 3) throw new Error('metrics unavailable');
		metricsActive++;
		try {
			if (!metricsDatabase) {
				const pool = postgres(DATABASE_URL, {
					max: 3,
					prepare: false,
					connect_timeout: 1,
					queue_timeout: 1,
					connection: {
						statement_timeout: 250,
						lock_timeout: 100,
						idle_in_transaction_session_timeout: 1000
					},
					onnotice: () => {}
				});
				metricsDatabase = drizzle(declareParams(pool), { schema });
			}
			// postgres-js 4 removes timed-out begin/reserve operations from its queue BEFORE
			// execution; no Promise.race can leave a late query running in the background.
			return await metricsDatabase.transaction(async (tx) => {
				await setMetricsRole(tx, role);
				return fn(tx);
			});
		} finally {
			metricsActive--;
		}
	};
}
