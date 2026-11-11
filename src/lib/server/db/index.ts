import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Database = ReturnType<typeof createDb>;

/** Pool sizing only. Everything that shapes the wire protocol stays fixed below. */
export type DbOptions = { max?: number };

export function createDb(url: string, options: DbOptions = {}) {
	// prepare: false keeps us compatible with Supabase's transaction pooler. The tests build their
	// databases through this same function, so this setting is exercised by `pnpm test` too.
	const client = postgres(url, { prepare: false, ...options });
	return drizzle(declareParams(client), { schema });
}

/**
 * Postgres's `unknown` type. Declared for a parameter, the server treats it exactly as it treats an
 * undeclared one (type 0): it decides the type from the query, as it always has.
 */
export const UNKNOWN_OID = 705;

/** Values written the same whatever type the server decides; anything else keeps the describe. */
function declarable(value: unknown) {
	return (
		value === null ||
		typeof value === 'string' ||
		typeof value === 'number' ||
		typeof value === 'boolean'
	);
}

/**
 * One round trip per parameterised query instead of two (EPSILON-145).
 *
 * With `prepare: false`, postgres-js 4 sends a query with any undeclared (type 0) parameter as
 * Parse/Describe/Flush, waits for the server to describe it, then sends Bind/Execute/Sync: two trips
 * across the Atlantic (knowledge decision ERMS 0029). When every parameter is declared it sends all
 * of that, with Sync, in one write. So each string, number, boolean or null parameter is declared as
 * `unknown`, which leaves the server to decide its type exactly as before. Those values are written
 * the same whatever type the server picks (with drizzle's json and date serializers), so no row
 * changes. A query with any other value (a Date, a Buffer, an array, an object) is left as it was.
 *
 * Still an unnamed statement, so nothing is prepared on the server and Supabase's transaction
 * pooler sees the same Parse/Bind/Execute/Sync that libpq's PQexecParams sends.
 *
 * Drizzle runs every query through `unsafe`, and its transactions and savepoints through `begin`
 * and `savepoint`, whose callbacks get their own client; those are wrapped too.
 */
export function declareParams<T extends postgres.Sql>(client: T, root: postgres.Sql = client): T {
	return new Proxy(client, {
		get(target, key) {
			const value = Reflect.get(target, key);
			if (key === 'unsafe') {
				return (query: string, params?: unknown, options?: unknown) =>
					target.unsafe(
						query,
						(Array.isArray(params) && params.every(declarable)
							? params.map((v) => (v === null ? v : root.typed(v, UNKNOWN_OID)))
							: params) as postgres.ParameterOrJSON<never>[],
						options as postgres.UnsafeQueryOptions
					);
			}
			if ((key === 'begin' || key === 'savepoint') && typeof value === 'function') {
				return (...args: unknown[]) => {
					const fn = args.pop() as (sql: postgres.Sql) => unknown;
					return value.call(target, ...args, (sql: postgres.Sql) => fn(declareParams(sql, root)));
				};
			}
			return value;
		}
	});
}

export { schema };
