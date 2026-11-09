import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, inject } from 'vitest';
import { createDb } from './db';
import { TEST_DB_PREFIX, withDatabase } from './test-db.global';

/**
 * A fresh, fully migrated database on the local Supabase stack, through the same `createDb` the
 * app uses — postgres-js, `prepare: false`, production's server build. For tests only.
 *
 * Each call copies the template test-db.global.ts built (CREATE DATABASE … TEMPLATE), so a test
 * gets an empty catalogue in tens of milliseconds instead of re-running every migration. The
 * databases a test file creates are dropped when the file finishes.
 */
export async function createTestDb() {
	const info = inject('testDb');
	if ('error' in info) throw new Error(info.error);

	const name = `${TEST_DB_PREFIX}${randomUUID().replaceAll('-', '').slice(0, 16)}`;
	await admin(info.adminUrl).unsafe(`CREATE DATABASE "${name}" TEMPLATE "${info.template}"`);

	// A small pool: test files run in parallel and some create a database per test, while the
	// stack's Postgres allows 100 connections in all.
	const db = createDb(withDatabase(info.adminUrl, name), { max: 3 });
	const client = db.$client;
	created.push({ name, client, adminUrl: info.adminUrl });
	return { db, client };
}

type Created = { name: string; client: postgres.Sql; adminUrl: string };
const created: Created[] = [];
let adminSql: postgres.Sql | undefined;

// More than one connection, or the parallel drops in the teardown would queue behind each other.
function admin(url: string) {
	adminSql ??= postgres(url, { max: 5, prepare: false, onnotice: () => {} });
	return adminSql;
}

// Registered when a test file first imports this module, so it runs once at the end of that file.
//
// A file like members.test.ts creates one database per test (20+), and the teardown used to close
// and drop them one after another. Every DROP DATABASE waits for its backends to exit and for a
// forced checkpoint, so on a busy CI runner the serial total passed the 10 s hook timeout (flaked on
// erms#44 and #48). The drops are independent, so they run together: the checkpoints they request
// coalesce and the total is about one drop, not N. The explicit timeout is only a backstop.
afterAll(async () => {
	const pending = created.splice(0);
	const results = await Promise.allSettled(
		pending.map(async ({ name, client, adminUrl }) => {
			await client.end({ timeout: 5 });
			await admin(adminUrl).unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
		})
	);
	await adminSql?.end({ timeout: 5 });
	adminSql = undefined;
	const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
	if (failed.length) throw failed[0].reason;
}, 30_000);
