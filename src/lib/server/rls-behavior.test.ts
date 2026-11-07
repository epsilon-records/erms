import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb } from './test-db';
import {
	RLS_CASES,
	SEED_SQL,
	SUPABASE_ROLE_SQL,
	TEARDOWN_SQL,
	assumeSql
} from '../../../scripts/rls-cases.mjs';

/**
 * Executes the shared RLS cases against PGlite — real Postgres, real row-level security, in
 * process, so `pnpm test` covers it without Docker. scripts/rls-behavior.mjs runs the same cases
 * against PostgreSQL 17 in CI, because PGlite's major (18.x) is newer than production's.
 *
 * These replace "61 policies exist" with "a cross-org read returns nothing".
 */

let handle: Awaited<ReturnType<typeof createTestDb>>;

const exec = (sql: string) => handle.client.exec(sql);

/** First column of the first row; every scalar probe is written to return exactly that. */
async function scalar(sql: string): Promise<string> {
	const result = await handle.client.query<Record<string, unknown>>(sql);
	const first = result.rows[0];
	if (!first) throw new Error(`probe returned no rows: ${sql.slice(0, 60)}`);
	return String(Object.values(first)[0]);
}

beforeAll(async () => {
	handle = await createTestDb();
	for (const statement of SUPABASE_ROLE_SQL) await exec(statement);
	for (const statement of SEED_SQL) await exec(statement);

	// Fail loudly rather than passing on an empty case list.
	expect(RLS_CASES.length).toBeGreaterThanOrEqual(10);
	// The seed must be visible to the owner, or every expectation below is noise.
	expect(await scalar('SELECT count(*) FROM labels')).toBe('2');
});

afterAll(async () => {
	if (!handle) return;
	for (const statement of TEARDOWN_SQL) {
		await exec(statement).catch(() => undefined);
	}
	await handle.client.close();
});

describe('row-level security behaviour', () => {
	for (const testCase of RLS_CASES) {
		// PGlite does not honour BYPASSRLS the way a server on disk does, so that one case is
		// checked on CI's PostgreSQL 17 by scripts/rls-behavior.mjs. Skipping it here is a named,
		// commented exception — the alternative is asserting a PGlite quirk as the security spec.
		const host = testCase.requiresBypassRls ? it.skip : it;
		host(testCase.name, async () => {
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
					// PGlite surfaces the SQLSTATE inconsistently, so accept the code or the
					// policy text: the assertion is about the refusal, not the driver shape.
					expect(
						detail.includes(testCase.errorCode ?? '') || /row-level security/i.test(detail),
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

	it('authenticated really holds table SELECT, so its filtered reads are RLS at work', async () => {
		const granted = await scalar(
			`SELECT count(*) FROM information_schema.role_table_grants
			      WHERE grantee = 'authenticated' AND table_schema = 'public'
			        AND privilege_type = 'SELECT'`
		);
		expect(Number(granted)).toBeGreaterThan(0);
	});
});
