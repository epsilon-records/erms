/**
 * Vitest global setup: prepares the database tests on the local Supabase stack.
 *
 * The database tests run on Supabase's own Postgres (`supabase start`), not on an engine we
 * assemble ourselves: the same server build production runs, the same `anon` / `authenticated` /
 * `service_role` roles and grants, and the same driver (postgres-js through `createDb`). An
 * in-process PGlite used to stand in for it; it was a newer major, a different driver and a 32-bit
 * build, so what passed there said little about production.
 *
 * Once per run this:
 *   1. connects to the stack (TEST_DATABASE_URL, default: the stack's local DB URL),
 *   2. refuses anything that is not local, or is not a Supabase server,
 *   3. builds a template database: Supabase's default privileges for `public`, then every
 *      migration in drizzle/,
 *   4. if the stack's own database is already migrated, checks the template grants the Supabase
 *      roles exactly what that database grants them.
 *
 * Each test file then gets fresh databases copied from the template (see test-db.ts).
 *
 * Nothing here falls back to another engine. If the stack is missing, the database tests fail
 * with the reason; the tests that need no database run as usual.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import type { TestProject } from 'vitest/node';

/** The local stack's documented DB URL; the port is `[db] port` in supabase/config.toml. */
export const DEFAULT_TEST_DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/** Every database this suite creates starts with this, so a run can clear its own leftovers. */
export const TEST_DB_PREFIX = 'erms_test_';
const TEMPLATE = `${TEST_DB_PREFIX}template`;

export type TestDbInfo = { adminUrl: string; template: string } | { error: string };

declare module 'vitest' {
	export interface ProvidedContext {
		testDb: TestDbInfo;
	}
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const SUPABASE_ROLES = ['anon', 'authenticated', 'service_role'] as const;

const HOW_TO_START =
	'Start the local Supabase stack and run the tests again:\n' +
	'  supabase start   (CLI 3.1.0-beta.26 or later: the first line with a PostgreSQL 17 image)\n' +
	'TEST_DATABASE_URL overrides the default ' +
	DEFAULT_TEST_DATABASE_URL;

export function withDatabase(url: string, database: string) {
	const next = new URL(url);
	next.pathname = `/${database}`;
	return next.toString();
}

/** ALTER DEFAULT PRIVILEGES object keywords, by pg_default_acl.defaclobjtype. */
const OBJECT_KEYWORD: Record<string, string> = {
	r: 'TABLES',
	S: 'SEQUENCES',
	f: 'FUNCTIONS',
	T: 'TYPES',
	n: 'SCHEMAS'
};

/**
 * Supabase's default privileges for objects `postgres` creates in `public` (and globally), read
 * from the stack and replayed in the template before any migration runs. Default privileges are
 * per database, so a fresh database would otherwise give `anon`/`authenticated` none of the table
 * privileges production gives them — a fixture weaker than production, which is exactly how a
 * security test passes when production would fail (knowledge erms/decisions/0017).
 */
async function supabaseDefaultPrivileges(admin: postgres.Sql): Promise<string[]> {
	const rows = await admin<
		{
			schema: string | null;
			objtype: string;
			grantee: string;
			privilege: string;
			grantable: boolean;
		}[]
	>`
		SELECT CASE WHEN d.defaclnamespace = 0 THEN NULL ELSE n.nspname END AS schema,
		       d.defaclobjtype AS objtype,
		       CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE quote_ident(pg_get_userbyid(a.grantee)) END AS grantee,
		       a.privilege_type AS privilege,
		       a.is_grantable AS grantable
		  FROM pg_default_acl d
		  LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
		 CROSS JOIN LATERAL aclexplode(d.defaclacl) a
		 WHERE d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = current_user)
		   AND (d.defaclnamespace = 0 OR n.nspname = 'public')
		   AND a.grantee <> d.defaclrole
		 ORDER BY 1 NULLS FIRST, 2, 3, 4`;

	const statements: string[] = [];
	const globalPublic = new Set<string>();
	for (const row of rows) {
		const keyword = OBJECT_KEYWORD[row.objtype];
		if (!keyword) continue;
		if (row.schema === null && row.grantee === 'PUBLIC') globalPublic.add(row.objtype);
		const scope = row.schema === null ? '' : ` IN SCHEMA ${row.schema}`;
		const option = row.grantable ? ' WITH GRANT OPTION' : '';
		statements.push(
			`ALTER DEFAULT PRIVILEGES${scope} GRANT ${row.privilege} ON ${keyword} TO ${row.grantee}${option}`
		);
	}

	// A global pg_default_acl row replaces the built-in defaults outright. If Supabase's global row
	// for functions or types leaves PUBLIC out, PUBLIC lost its built-in EXECUTE / USAGE there.
	const globalTypes = new Set(rows.filter((r) => r.schema === null).map((r) => r.objtype));
	if (globalTypes.has('f') && !globalPublic.has('f')) {
		statements.push('ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC');
	}
	if (globalTypes.has('T') && !globalPublic.has('T')) {
		statements.push('ALTER DEFAULT PRIVILEGES REVOKE USAGE ON TYPES FROM PUBLIC');
	}
	return statements;
}

/** What the Supabase roles hold on ERMS's own objects, as one comparable list. */
async function supabaseRoleGrants(sql: postgres.Sql): Promise<string[]> {
	const rows = await sql<{ g: string }[]>`
		SELECT grantee || ' ' || privilege_type || ' ' || table_schema || '.' || table_name AS g
		  FROM information_schema.role_table_grants
		 WHERE grantee IN ('anon', 'authenticated', 'service_role') AND table_schema IN ('public', 'app', 'app_metrics')
		UNION
		SELECT grantee || ' ' || privilege_type || ' ' || routine_schema || '.' || routine_name
		  FROM information_schema.role_routine_grants
		 WHERE grantee IN ('anon', 'authenticated', 'service_role') AND routine_schema IN ('public', 'app', 'app_metrics')
		ORDER BY 1`;
	return rows.map((r) => r.g);
}

async function dropOurDatabases(admin: postgres.Sql) {
	const rows = await admin<{ datname: string }[]>`
		SELECT datname FROM pg_database WHERE starts_with(datname, ${TEST_DB_PREFIX})`;
	for (const { datname } of rows) {
		await admin.unsafe(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
	}
}

async function prepare(adminUrl: string): Promise<TestDbInfo> {
	const host = new URL(adminUrl).hostname;
	if (!LOCAL_HOSTS.has(host)) {
		// The suite creates and drops databases; it never runs against a remote server.
		return { error: `TEST_DATABASE_URL must point at the local Supabase stack, not ${host}.` };
	}

	const admin = postgres(adminUrl, { max: 1, prepare: false, onnotice: () => {} });
	try {
		try {
			await admin`SELECT 1`;
		} catch (error) {
			return {
				error: `Cannot reach the database tests' Postgres at ${host} (${(error as Error).message}).\n${HOW_TO_START}`
			};
		}

		const roles = await admin<{ rolname: string }[]>`
			SELECT rolname FROM pg_roles WHERE rolname IN ${admin(SUPABASE_ROLES)}`;
		if (roles.length !== SUPABASE_ROLES.length) {
			return {
				error:
					'TEST_DATABASE_URL is a Postgres server but not a Supabase stack (no anon / ' +
					'authenticated / service_role). The database tests run on Supabase itself.\n' +
					HOW_TO_START
			};
		}

		// One run per stack at a time: this clears whatever an earlier, interrupted run left.
		await dropOurDatabases(admin);
		const defaults = await supabaseDefaultPrivileges(admin);
		await admin.unsafe(`CREATE DATABASE "${TEMPLATE}" TEMPLATE template0`);

		const templateUrl = withDatabase(adminUrl, TEMPLATE);
		const template = postgres(templateUrl, { max: 1, prepare: false, onnotice: () => {} });
		try {
			for (const statement of defaults) await template.unsafe(statement);
			await migrate(drizzle(template), { migrationsFolder: './drizzle' });

			// When the stack's own database carries the migrations too (CI migrates it first), the
			// template must grant the Supabase roles exactly what it grants. Any gap is a fixture
			// that differs from production, so it stops the run.
			const [{ migrated }] = await admin<{ migrated: boolean }[]>`
				SELECT to_regclass('public.labels') IS NOT NULL AS migrated`;
			if (migrated) {
				const [expected, actual] = await Promise.all([
					supabaseRoleGrants(admin),
					supabaseRoleGrants(template)
				]);
				const missing = expected.filter((g) => !actual.includes(g));
				const extra = actual.filter((g) => !expected.includes(g));
				if (missing.length || extra.length) {
					return {
						error:
							"The test template's grants differ from the stack's own database.\n" +
							`missing: ${missing.slice(0, 10).join('; ') || '-'}\n` +
							`extra:   ${extra.slice(0, 10).join('; ') || '-'}`
					};
				}
			}
		} finally {
			// No session may stay on the template, or CREATE DATABASE … TEMPLATE refuses it.
			await template.end({ timeout: 5 });
		}
		return { adminUrl, template: TEMPLATE };
	} finally {
		await admin.end({ timeout: 5 });
	}
}

export default async function setup(project: TestProject) {
	const adminUrl = process.env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL;
	let info: TestDbInfo;
	try {
		info = await prepare(adminUrl);
	} catch (error) {
		info = { error: `Preparing the test database failed: ${(error as Error).message}` };
	}
	project.provide('testDb', info);

	return async () => {
		if ('error' in info) return;
		const admin = postgres(adminUrl, { max: 1, prepare: false, onnotice: () => {} });
		try {
			await dropOurDatabases(admin);
		} finally {
			await admin.end({ timeout: 5 });
		}
	};
}
