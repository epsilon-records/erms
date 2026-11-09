/** Browser→real receiver→restricted SQL proof on an isolated DB of the real local Supabase stack. */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const source = process.env.TEST_DATABASE_URL;
assert(source, 'TEST_DATABASE_URL required; no stand-in storage');
const url = new URL(source);
assert(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'only local Supabase');
const admin = postgres(source, { max: 1, prepare: false });
const name = 'erms_metrics_browser_' + randomUUID().replaceAll('-', '');
let database;
try {
	const roles =
		await admin`select rolname from pg_roles where rolname in ('anon','authenticated','service_role')`;
	assert.equal(roles.length, 3, 'real Supabase roles required');
	const [{ major }] = await admin`select current_setting('server_version_num')::int/10000 as major`;
	assert.equal(major, 17);
	// Replay the stack's actual default grants, never a fabricated SELECT-only approximation.
	const grants =
		await admin`select case when d.defaclnamespace=0 then null else n.nspname end as schema,d.defaclobjtype as type,case when a.grantee=0 then 'PUBLIC' else quote_ident(pg_get_userbyid(a.grantee)) end as grantee,a.privilege_type as privilege,a.is_grantable as grantable from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace cross join lateral aclexplode(d.defaclacl) a where d.defaclrole=(select oid from pg_roles where rolname=current_user) and (d.defaclnamespace=0 or n.nspname='public') and a.grantee<>d.defaclrole`;
	await admin.unsafe(`CREATE DATABASE "${name}" TEMPLATE template0`);
	url.pathname = '/' + name;
	database = postgres(url.toString(), { max: 1, prepare: false });
	const keywords = { r: 'TABLES', S: 'SEQUENCES', f: 'FUNCTIONS', T: 'TYPES', n: 'SCHEMAS' };
	for (const g of grants) {
		if (!keywords[g.type]) continue;
		await database.unsafe(
			`ALTER DEFAULT PRIVILEGES${g.schema ? ' IN SCHEMA public' : ''} GRANT ${g.privilege} ON ${keywords[g.type]} TO ${g.grantee}${g.grantable ? ' WITH GRANT OPTION' : ''}`
		);
	}
	for (const [type, privilege, keyword] of [
		['f', 'EXECUTE', 'FUNCTIONS'],
		['T', 'USAGE', 'TYPES']
	])
		if (
			grants.some((g) => g.schema === null && g.type === type) &&
			!grants.some((g) => g.schema === null && g.type === type && g.grantee === 'PUBLIC')
		)
			await database.unsafe(
				`ALTER DEFAULT PRIVILEGES REVOKE ${privilege} ON ${keyword} FROM PUBLIC`
			);
	await migrate(drizzle(database), { migrationsFolder: './drizzle' });
	// Assert the private grants after migration, independently of the receiver code.
	for (const role of [
		'anon',
		'authenticated',
		'service_role',
		'erms_app',
		'erms_metrics_ingest',
		'erms_metrics_prune'
	]) {
		const [r] =
			await database`select has_table_privilege(${role},'app_metrics.app_performance_daily','SELECT') as allowed`;
		assert.equal(r.allowed, false, role);
	}
	await database.end();
	database = undefined;
	const child = spawn(process.execPath, ['scripts/app-metrics-privacy.cdp.mjs'], {
		stdio: 'inherit',
		env: { ...process.env, METRICS_TEST_DATABASE_URL: url.toString() }
	});
	const code = await new Promise((resolve, reject) => {
		child.on('error', reject);
		child.on('exit', resolve);
	});
	assert.equal(code, 0, 'browser real-stack proof failed');
} finally {
	await database?.end({ timeout: 1 });
	await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
	await admin.end();
}
