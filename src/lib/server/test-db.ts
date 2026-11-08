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

function admin(url: string) {
	adminSql ??= postgres(url, { max: 1, prepare: false, onnotice: () => {} });
	return adminSql;
}

// Registered when a test file first imports this module, so it runs once at the end of that file.
afterAll(async () => {
	for (const { name, client, adminUrl } of created.splice(0)) {
		await client.end({ timeout: 5 });
		await admin(adminUrl).unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
	}
	await adminSql?.end({ timeout: 5 });
	adminSql = undefined;
});
