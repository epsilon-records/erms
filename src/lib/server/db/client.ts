import { DATABASE_URL } from '$app/env/private';
import { createDb, schema } from './index';

let instance: ReturnType<typeof createDb> | undefined;

/** Lazily created so `vite build` never opens a connection. */
export function db() {
	instance ??= createDb(DATABASE_URL);
	return instance;
}

// Separate small pool: no catalogue workload can queue anonymous metrics behind product queries.
// At most two ingest + one maintenance callers reach this pool; connection setup times out in 1s.
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { setMetricsRole, type MetricsRole, type Scoped } from './scoped';
let metricsPool: ReturnType<typeof postgres> | undefined;
let metricsActive = 0;
export function metricsRunner(role: MetricsRole): Scoped {
	return async (fn) => {
		if (metricsActive >= 3) throw new Error('metrics unavailable');
		metricsActive++;
		metricsPool ??= postgres(DATABASE_URL, {
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
		try {
			// postgres-js 4 removes timed-out begin/reserve operations from its queue BEFORE
			// execution; no Promise.race can leave a late query running in the background.
			return await metricsPool.begin(async (connection) => {
				const tx = drizzle(connection as unknown as postgres.Sql, { schema });
				await setMetricsRole(tx, role);
				return fn(tx);
			});
		} finally {
			metricsActive--;
		}
	};
}
