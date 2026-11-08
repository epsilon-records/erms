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
	return drizzle(client, { schema });
}

export { schema };
