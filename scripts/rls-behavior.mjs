/**
 * Row-level security, checked against the database behind DATABASE_URL.
 *
 * `pnpm test` runs the same cases in a fresh copy of the migrated template on the Supabase stack.
 * This host runs them in the stack's own database — the one `pnpm db:migrate` applied the
 * migrations to and PostgREST serves — so the grants are the ones Supabase itself put there.
 *
 * Run: supabase start
 *      DATABASE_URL=$(supabase status --output json | jq -r .DB_URL) pnpm db:migrate && pnpm test:rls
 */
import postgres from 'postgres';
import { RLS_CASES, SEED_SQL, TEARDOWN_SQL, assumeSql } from './rls-cases.mjs';

const url = process.env.DATABASE_URL;
if (!url) {
	console.error(
		'DATABASE_URL is not set. This host exists to check RLS on the server version production ' +
			'runs, so it refuses to fall back to anything else.\n' +
			'Local: supabase start, point DATABASE_URL at it, pnpm db:migrate, then re-run.\n' +
			'CI: the check job in .github/workflows/ci.yml points it at the stack.'
	);
	process.exit(2);
}

const sql = postgres(url, { max: 1, prepare: false });

/**
 * Sentinel thrown to unwind the transaction that opened each case. Every probe — including the ones
 * that legitimately write inside the caller own org — must leave the database exactly as it was
 * found, so no case inherits another case's rows.
 */
const ROLLBACK = Symbol('rollback');
const results = [];
let failures = 0;

const scalar = async (statement) => {
	const rows = await sql.unsafe(statement);
	if (!rows.length) throw new Error('probe returned no rows');
	return String(Object.values(rows[0])[0]);
};

try {
	const [{ version }] = await sql`SELECT current_setting('server_version') AS version`;
	const [{ num }] = await sql`SELECT current_setting('server_version_num')::int / 10000 AS num`;
	console.log(`PostgreSQL ${version} (major ${num})\n`);

	if (Number(num) !== 17) {
		// Not a failure: production may move. Loud enough that a silent drift is visible in CI.
		console.log(
			`NOTE: expecting major 17 (production); got ${num}. Update scripts/rls-cases.mjs too.\n`
		);
	}

	// The migrations must be applied: this host deliberately does not create the schema.
	try {
		await sql`SELECT count(*) FROM labels`;
	} catch {
		throw new Error('the schema is not there yet — run `pnpm db:migrate` first');
	}

	// Supabase's own roles are detected, never created: fabricating them here once produced a
	// simulation stricter than production (see rls-cases.mjs). Absent roles means those cases skip.
	const roleRows =
		await sql`SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')`;
	const hasSupabaseRoles = roleRows.length === 3;
	const serviceBypass = await sql`
		SELECT coalesce((to_jsonb(r) ->> 'rolbypassrls'), (to_jsonb(r) ->> 'bypassrls')) AS b
		  FROM pg_roles r WHERE rolname = 'service_role'`;
	const honoursBypass = serviceBypass[0]?.b === 'true';

	// Clear first, then seed: the order was reversed once and the cleanup deleted the rows the
	// cases depend on, so the run reported 0 labels instead of testing anything.
	for (const statement of TEARDOWN_SQL) await sql.unsafe(statement).catch(() => undefined);
	await sql`
		DELETE FROM memberships WHERE user_id IN (
			'11111111-1111-4111-8111-111111111111',
			'22222222-2222-4222-8222-222222222222',
			'33333333-3333-4333-8333-333333333333')`;
	for (const statement of SEED_SQL) await sql.unsafe(statement);
	const seeded = await scalar('SELECT count(*) FROM labels');
	if (seeded !== '2') throw new Error(`seed expected 2 labels, found ${seeded}`);

	for (const testCase of RLS_CASES) {
		if (testCase.requiresSupabaseRoles && !hasSupabaseRoles) {
			results.push(['skip ', testCase.role ?? '', testCase.name, 'engine has no Supabase roles']);
			continue;
		}
		if (testCase.requiresBypassRls && !honoursBypass) {
			results.push([
				'skip ',
				testCase.role ?? '',
				testCase.name,
				'engine does not honour BYPASSRLS'
			]);
			continue;
		}
		let outcome = '';
		try {
			await sql.begin(async (tx) => {
				await tx.unsafe(assumeSql(testCase.role, testCase.claim));

				if (testCase.expect === 'error') {
					let message = '';
					let code = '';
					try {
						await tx.unsafe(testCase.probe);
					} catch (error) {
						message = String(error?.message ?? '');
						code = String(error?.code ?? '');
					}
					if (!message) throw new Error('the probe succeeded; RLS did not refuse it');
					const matched = code === testCase.errorCode || /row-level security/i.test(message);
					if (!matched) throw new Error(`refused for the wrong reason: ${code} ${message}`);
					// Force the rollback: a refused statement must not leave anything behind.
					throw ROLLBACK;
				}

				const value = await tx
					.unsafe(testCase.probe)
					.then((rows) => String(Object.values(rows[0] ?? {})[0]));
				if (value !== String(testCase.expect)) {
					throw new Error(`expected ${testCase.expect}, got ${value}`);
				}
				throw ROLLBACK;
			});
			outcome = 'pass';
		} catch (error) {
			if (error === ROLLBACK) outcome = 'pass';
			else {
				outcome = `FAIL: ${error.message}`;
				failures += 1;
			}
		}
		results.push([outcome === 'pass' ? 'ok  ' : 'FAIL', testCase.role, testCase.name, outcome]);
	}

	// Structural facts the behavioural cases lean on.
	const structural = await sql`
		SELECT
			-- The jsonb lookup spans majors: pg_roles.rolbypassrls was renamed in PostgreSQL 18, and
			-- has_bypassrls_privilege() does not exist on 17, so either single spelling would pin this
			-- check to one version.
			(coalesce((select (to_jsonb(r) ->> 'rolbypassrls') from pg_roles r where rolname = 'erms_app'),
			          (select (to_jsonb(r) ->> 'bypassrls')      from pg_roles r where rolname = 'erms_app')))
				= 'false' AS app_no_bypass,
			(coalesce((select (to_jsonb(r) ->> 'rolbypassrls') from pg_roles r where rolname = 'service_role'),
			          (select (to_jsonb(r) ->> 'bypassrls')      from pg_roles r where rolname = 'service_role')))
				= 'true' AS service_bypass,
			-- anon/authenticated must really hold table privileges; otherwise their filtered reads
			-- would be a permission accident rather than evidence that RLS did the work. Supabase
			-- grants INSERT/UPDATE/DELETE here too, which is why the write cases below matter.
			(SELECT count(*) > 0 FROM information_schema.role_table_grants
			  WHERE grantee = 'authenticated' AND table_schema = 'public'
			    AND privilege_type = 'SELECT') AS grantee_has_select,
			(SELECT count(*) > 0 FROM information_schema.role_table_grants
			  WHERE grantee = 'authenticated' AND table_schema = 'public'
			    AND privilege_type = 'INSERT') AS grantee_can_insert,
			-- The asymmetry every case above encodes: reads carry no TO clause (they reach PUBLIC,
			-- which is why authenticated reads its own org, writes are addressed to erms_app only.
			(SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
			  AND cmd <> 'SELECT' AND roles::text[] && array['anon', 'authenticated']) AS foreign_writes,
			(SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
			  AND cmd = 'SELECT' AND roles::text[] @> array['public']) AS public_reads,
			(SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
			  AND cmd <> 'SELECT' AND roles::text[] @> array['erms_app']) AS scoped_writes
	`;
	const row = structural[0];

	// Some of these are claims about Supabase, not about Postgres. They are listed as not
	// applicable on an engine without the roles rather than guarded by a boolean — a check that
	// quietly becomes `true ||` on another engine is how this file failed CI once already.
	const isSupabase = hasSupabaseRoles;
	const checks = [
		{
			label: 'erms_app cannot bypass RLS',
			applies: true,
			ok: row.app_no_bypass === true || row.app_no_bypass === 't'
		},
		{
			label: 'service_role does bypass RLS (the one trusted path)',
			applies: isSupabase,
			ok: row.service_bypass === true || row.service_bypass === 't'
		},
		{
			label: 'authenticated holds SELECT, so its filtered reads are RLS at work',
			applies: isSupabase,
			ok: row.grantee_has_select === true || row.grantee_has_select === 't'
		},
		{
			// The premise that made the write cases matter: production grants the REST roles write
			// privileges, so only the policies stand between a user JWT and a catalogue mutation.
			label: 'authenticated holds INSERT too: RLS, not privileges, is the wall',
			applies: isSupabase,
			ok: row.grantee_can_insert === true || row.grantee_can_insert === 't'
		},
		{
			label: 'no write policy is addressed to anon or authenticated',
			applies: true,
			ok: Number(row.foreign_writes) === 0
		},
		{
			label: 'reads reach PUBLIC while writes reach only erms_app',
			applies: true,
			ok: Number(row.public_reads) > 0 && Number(row.scoped_writes) > 0
		}
	];
	const running = checks.filter((c) => c.applies);
	const notApplicable = checks.filter((c) => !c.applies);
	for (const check of running) {
		if (!check.ok) {
			console.log(`FAIL ${check.label}`);
			failures += 1;
		}
	}
	console.log(
		`\nstructural: ${running.filter((c) => c.ok).length}/${running.length} passed${notApplicable.length ? ` (${notApplicable.length} not applicable: no Supabase roles)` : ''}  ` +
			`(public reads ${row.public_reads}, scoped writes ${row.scoped_writes}, ` +
			`foreign writes ${row.foreign_writes})`
	);
} catch (error) {
	console.log(`FAIL ${error.message ?? String(error)}`);
	failures += 1;
} finally {
	for (const statement of TEARDOWN_SQL) await sql.unsafe(statement).catch(() => undefined);
	await sql.end({ timeout: 5 });
}

for (const [status, role, name, outcome] of results) {
	console.log(
		`${status}\t${role.padEnd(13)}\t${name}${outcome === 'pass' ? '' : `\n\t\t${outcome}`}`
	);
}
const failedCases = results.filter((r) => r[0] === 'FAIL').length;
const skipped = results.filter((r) => r[0].startsWith('skip')).length;
const ran = results.length - skipped;
console.log(
	`\n${ran} behaviour cases ran: ${ran - failedCases} passed, ${failedCases} failed` +
		(skipped ? `  (${skipped} skipped: engine cannot honour them)` : '')
);
process.exit(failures ? 1 : 0);
