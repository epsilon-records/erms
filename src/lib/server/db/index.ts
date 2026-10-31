import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Database = ReturnType<typeof createDb>;

export function createDb(url: string) {
	// prepare: false keeps us compatible with Supabase's transaction pooler.
	const client = postgres(url, { prepare: false });
	return drizzle(client, { schema });
}

export { schema };
