import type postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from './test-db';
import { RLS_CASES, SEED_SQL, TEARDOWN_SQL, assumeSql } from '../../../scripts/rls-cases.mjs';

/**
 * Executes the shared RLS cases on the local Supabase stack — production's server build, with
 * Supabase's own anon / authenticated / service_role and their real grants — so every case runs,
 * including the ones that need those roles or BYPASSRLS. scripts/rls-behavior.mjs runs the same
 * cases against the stack's own database in CI, and scripts/rls-postgrest.mjs the HTTP layer.
 *
 * These replace "61 policies exist" with "a cross-org read returns nothing".
 */

let conn: postgres.ReservedSql;

// One reserved connection, so BEGIN … ROLLBACK and the role switch stay on the same session.
const exec = (sql: string) => conn.unsafe(sql);

/** First column of the first row; every scalar probe is written to return exactly that. */
async function scalar(sql: string): Promise<string> {
	const rows = await conn.unsafe<Record<string, unknown>[]>(sql);
	const first = rows[0];
	if (!first) throw new Error(`probe returned no rows: ${sql.slice(0, 60)}`);
	return String(Object.values(first)[0]);
}

beforeAll(async () => {
	const { client } = await createTestDb();
	conn = await client.reserve();
	for (const statement of SEED_SQL) await exec(statement);

	// Fail loudly rather than passing on an empty case list.
	expect(RLS_CASES.length).toBeGreaterThanOrEqual(10);
	// The seed must be visible to the owner, or every expectation below is noise.
	expect(await scalar('SELECT count(*) FROM labels')).toBe('2');
});

afterAll(async () => {
	if (!conn) return;
	for (const statement of TEARDOWN_SQL) {
		await exec(statement).catch(() => undefined);
	}
	conn.release();
});

describe('row-level security behaviour', () => {
	for (const testCase of RLS_CASES) {
		// No skips: this host is the Supabase stack, so a case needing its roles or BYPASSRLS that
		// fails here is a finding, not a fixture gap.
		it(testCase.name, async () => {
			await exec('BEGIN');
			try {
				await exec(assumeSql(testCase.role, testCase.claim));

				if (testCase.expect === 'error') {
					let refused = false;
					let detail = '';
					try {
						await exec(testCase.probe);
					} catch (error) {
						refused = true;
						detail = `${(error as { code?: string }).code ?? ''} ${(error as Error).message ?? ''}`;
					}
					if (!refused) {
						throw new Error(`the probe succeeded; RLS did not refuse it`);
					}
					// The same rule as scripts/rls-behavior.mjs: the expected SQLSTATE, or a refusal
					// that names row-level security.
					// errorMatch narrows it: the expected SQLSTATE and that message, nothing else.
					const errorMatch = (testCase as { errorMatch?: string }).errorMatch;
					expect(
						errorMatch
							? detail.includes(testCase.errorCode ?? '') &&
									new RegExp(errorMatch, 'i').test(detail)
							: detail.includes(testCase.errorCode ?? '') || /row-level security/i.test(detail),
						`unexpected refusal: ${detail.trim().slice(0, 160)}`
					).toBe(true);
					return;
				}

				expect(await scalar(testCase.probe)).toBe(String(testCase.expect));
			} finally {
				// Every case rolls back, so a probe that writes cannot leak into the next one.
				await exec('ROLLBACK');
			}
		});
	}
});

describe('the mechanisms the cases rely on', () => {
	it('set_config(role) changes the effective role', async () => {
		await exec('BEGIN');
		try {
			await exec(assumeSql('erms_app', null));
			expect(await scalar('SELECT current_user')).toBe('erms_app');
		} finally {
			await exec('ROLLBACK');
		}
	});

	// pg_roles.rolbypassrls was renamed in PostgreSQL 18 and has_bypassrls_privilege() does not
	// exist in 17, so the jsonb lookup is the only form that runs on both this host and CI's 17.
	const bypassOf = (role: string) =>
		scalar(
			`SELECT coalesce((to_jsonb(r) ->> 'rolbypassrls'), (to_jsonb(r) ->> 'bypassrls'))
			   FROM pg_roles r WHERE rolname = '${role}'`
		);

	it('erms_app cannot bypass RLS', async () => {
		expect(await bypassOf('erms_app')).toBe('false');
	});

	// Reads carry no TO clause, so they reach PUBLIC — that is why `authenticated` can read its own
	// org. Writes are addressed to erms_app only, which is why the same role cannot write at all.
	// roles is name[], so the array operators need a text[] cast to compare against literals.
	const policyCount = (where: string) =>
		scalar(`SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND ${where}`);

	it('reads reach PUBLIC while every write is addressed to erms_app', async () => {
		expect(
			Number(await policyCount("cmd = 'SELECT' AND roles::text[] @> array['public']"))
		).toBeGreaterThan(0);
		expect(
			Number(await policyCount("cmd <> 'SELECT' AND roles::text[] @> array['erms_app']"))
		).toBeGreaterThan(0);
		expect(
			Number(
				await policyCount("cmd <> 'SELECT' AND roles::text[] && array['anon', 'authenticated']")
			)
		).toBe(0);
	});

	// Supabase's side of the premise. A test database is a copy of a template, so these also prove
	// the template carries Supabase's grants rather than a weaker set (knowledge labelkit/decisions/0017).
	it('service_role bypasses RLS (the one trusted path)', async () => {
		expect(await bypassOf('service_role')).toBe('true');
	});

	const holds = (privilege: string) =>
		scalar(
			`SELECT count(*) > 0 FROM information_schema.role_table_grants
			  WHERE grantee = 'authenticated' AND table_schema = 'public'
			    AND privilege_type = '${privilege}'`
		);

	it('authenticated holds SELECT, so its filtered reads are RLS at work', async () => {
		expect(await holds('SELECT')).toBe('true');
	});

	// Production grants the REST roles write privileges, so only the policies stand between a user
	// JWT and a catalogue write. If this ever reads false, the write cases above prove nothing.
	it('authenticated holds INSERT too: RLS, not privileges, is the wall', async () => {
		expect(await holds('INSERT')).toBe('true');
	});

	it('write policies are addressed to erms_app', async () => {
		const scoped = await scalar(
			`SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
			   AND cmd <> 'SELECT' AND roles::text[] @> array['erms_app']`
		);
		expect(Number(scoped)).toBeGreaterThan(0);
	});

	it('read policies carry no TO clause, so they reach PUBLIC', async () => {
		const publicReads = await scalar(
			`SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
			   AND cmd = 'SELECT' AND roles::text[] @> array['public']`
		);
		expect(Number(publicReads)).toBeGreaterThan(0);
	});
});
