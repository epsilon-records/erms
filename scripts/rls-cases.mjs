/**
 * Row-level-security behaviour, as data.
 *
 * Why this exists: RLS was the one security-relevant layer in ERMS with no behavioural test
 * anywhere. The suite ran migrations on PostgreSQL 17 in CI and asserted role/policy *counts*,
 * which proves the DDL executed — not that a cross-org read is denied, that a session-less request
 * fails closed, or that a request shaped like Supabase's own API (a role that holds SELECT on the
 * tables but matches no policy) sees nothing.
 *
 * Each case opens a transaction, assumes a role, sets the claim the app sets, runs one probe, and
 * rolls back. The assumption mechanism is deliberately the app's own — `set_config('role', …)` plus
 * `set_config('request.jwt.claim.sub', …)` from `src/lib/server/db/scoped.ts` — so a change to how
 * the app scopes a request moves these results or breaks them.
 *
 * Consumed twice:
 *  - src/lib/server/rls-behavior.test.ts  (vitest + PGlite, runs on every `pnpm test`)
 *  - scripts/rls-behavior.mjs             (real PostgreSQL 17 in CI, production's major)
 */

export const IDS = {
	orgA: 'a0000000-0000-4000-8000-00000000000a',
	orgB: 'b0000000-0000-4000-8000-00000000000b',
	labelA: 'c0000000-0000-4000-8000-00000000000c',
	labelB: 'd0000000-0000-4000-8000-00000000000d',
	// Written by probes that must clean up after themselves (each case rolls back anyway).
	sneakLabel: 'e0000000-0000-4000-8000-00000000000e',
	freshLabel: 'f0000000-0000-4000-8000-00000000000f',
	// u1 owns org A only. u2 owns org B. u3 has no membership anywhere.
	u1: '11111111-1111-4111-8111-111111111111',
	u2: '22222222-2222-4222-8222-222222222222',
	u3: '33333333-3333-4333-8333-333333333333'
};

/**
 * The three roles Supabase ships and PostgREST uses. Production has them; a bare Postgres does
 * not, so CI and PGlite must create them or the most important case — "a role with SELECT on the
 * table still sees nothing" — would pass for the wrong reason (no privilege, not RLS).
 */
export const SUPABASE_ROLE_SQL = [
	`DO $$ BEGIN
		IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN NOBYPASSRLS; END IF;
		IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN NOBYPASSRLS; END IF;
		IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
	END $$`,
	// What Supabase's own defaults grant: table access without any policy of ours applying.
	`GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role`,
	`GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated`,
	`GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role`
];

export const SEED_SQL = [
	`INSERT INTO orgs (id, name, slug) VALUES
		('${IDS.orgA}', 'Alpha Records', 'alpha'),
		('${IDS.orgB}', 'Beta Records', 'beta')`,
	`INSERT INTO memberships (org_id, user_id, role) VALUES
		('${IDS.orgA}', '${IDS.u1}', 'owner'),
		('${IDS.orgB}', '${IDS.u2}', 'owner')`,
	`INSERT INTO labels (id, org_id, name) VALUES
		('${IDS.labelA}', '${IDS.orgA}', 'Alpha Sound'),
		('${IDS.labelB}', '${IDS.orgB}', 'Beta Sound')`
];

export const TEARDOWN_SQL = [
	`DELETE FROM labels WHERE id IN ('${IDS.labelA}', '${IDS.labelB}', '${IDS.sneakLabel}', '${IDS.freshLabel}')`,
	`DELETE FROM memberships WHERE user_id IN ('${IDS.u1}', '${IDS.u2}', '${IDS.u3}')`,
	`DELETE FROM orgs WHERE id IN ('${IDS.orgA}', '${IDS.orgB}')`
];

/**
 * `role` + `claim: null` means no session at all. `expect` is a scalar, or `'error'` for a probe
 * that must be refused (`errorCode` is the SQLSTATE Postgres has to raise, so a policy that
 * silently filters is not confused with one that blocks a write).
 */
export const RLS_CASES = [
	{
		name: 'a member reads their own org',
		role: 'erms_app',
		claim: IDS.u1,
		probe: `SELECT count(*) FROM labels WHERE org_id = '${IDS.orgA}'`,
		expect: '1'
	},
	{
		name: 'a member cannot read another org, even by explicit id',
		role: 'erms_app',
		claim: IDS.u1,
		probe: `SELECT count(*) FROM labels WHERE org_id = '${IDS.orgB}'`,
		expect: '0'
	},
	{
		name: 'an unfiltered read returns only the caller org across all labels',
		role: 'erms_app',
		claim: IDS.u1,
		probe: 'SELECT count(*) FROM labels',
		expect: '1'
	},
	{
		name: 'the orgs table is member-scoped too',
		role: 'erms_app',
		claim: IDS.u1,
		probe: 'SELECT count(*) FROM orgs',
		expect: '1'
	},
	{
		name: 'UPDATE across orgs affects no rows',
		role: 'erms_app',
		claim: IDS.u1,
		probe: `WITH upd AS (
			UPDATE labels SET name = 'hijacked' WHERE org_id = '${IDS.orgB}' RETURNING 1
		) SELECT count(*) FROM upd`,
		expect: '0'
	},
	{
		name: 'DELETE across orgs affects no rows',
		role: 'erms_app',
		claim: IDS.u1,
		probe: `WITH del AS (
			DELETE FROM labels WHERE org_id = '${IDS.orgB}' RETURNING 1
		) SELECT count(*) FROM del`,
		expect: '0'
	},
	{
		name: 'INSERT into another org is refused, not filtered',
		role: 'erms_app',
		claim: IDS.u1,
		probe: `INSERT INTO labels (id, org_id, name)
			VALUES ('${IDS.sneakLabel}', '${IDS.orgB}', 'sneaked in')`,
		expect: 'error',
		errorCode: '42501' // new row violates row-level security policy
	},
	{
		name: 'INSERT into the caller own org is allowed for an owner',
		role: 'erms_app',
		claim: IDS.u1,
		// The id is supplied because labels.id is generated by the app (uuidv7), not by the
		// database — a probe that omitted it would fail on the constraint, not on the policy.
		probe: `WITH ins AS (
			INSERT INTO labels (id, org_id, name)
			VALUES ('${IDS.freshLabel}', '${IDS.orgA}', 'Fresh Alpha') RETURNING 1
		) SELECT count(*) FROM ins`,
		expect: '1'
	},
	{
		name: 'no session claim means no rows at all (fail closed)',
		role: 'erms_app',
		claim: null,
		probe: 'SELECT count(*) FROM labels',
		expect: '0'
	},
	{
		name: 'a user with no membership reads nothing',
		role: 'erms_app',
		claim: IDS.u3,
		probe: 'SELECT count(*) FROM labels',
		expect: '0'
	},
	{
		name: 'the claim is not the org: a member of A cannot pass B id as sub',
		role: 'erms_app',
		claim: IDS.u2,
		probe: `SELECT count(*) FROM labels WHERE id = '${IDS.labelA}'`,
		expect: '0'
	},
	// The PostgREST-shaped surface (Supabase's own API, reached with the publishable key plus a
	// user JWT). The member-read policies carry no TO clause, so they apply to PUBLIC — which
	// means this path reads *within* the caller org, by design. What must not happen is a
	// cross-org read, or any write: every catalog write policy is addressed TO erms_app.
	{
		name: 'authenticated reads its own org through the public read policies',
		role: 'authenticated',
		claim: IDS.u1,
		probe: `SELECT count(*) FROM labels WHERE org_id = '${IDS.orgA}'`,
		expect: '1'
	},
	{
		name: 'authenticated cannot read another org',
		role: 'authenticated',
		claim: IDS.u1,
		probe: `SELECT count(*) FROM labels WHERE org_id = '${IDS.orgB}'`,
		expect: '0'
	},
	{
		name: 'authenticated with no claim reads nothing',
		role: 'authenticated',
		claim: null,
		probe: 'SELECT count(*) FROM labels',
		expect: '0'
	},
	{
		name: 'authenticated cannot write: catalog writes are addressed to erms_app only',
		role: 'authenticated',
		claim: IDS.u1,
		probe: `INSERT INTO labels (id, org_id, name)
			VALUES ('${IDS.sneakLabel}', '${IDS.orgA}', 'via postgrest')`,
		expect: 'error',
		// Either refusal is correct here: no INSERT policy (42501 row security) or no
		// privilege at all (also 42501, permission denied). Both mean the write cannot happen.
		errorCode: '42501'
	},
	{
		name: 'anon has the same public read policies but no identity, so it reads nothing',
		role: 'anon',
		claim: null,
		probe: 'SELECT count(*) FROM labels',
		expect: '0'
	},
	{
		name: 'anon cannot write either',
		role: 'anon',
		claim: null,
		probe: `INSERT INTO labels (id, org_id, name)
			VALUES ('${IDS.sneakLabel}', '${IDS.orgA}', 'via anon')`,
		expect: 'error',
		errorCode: '42501'
	},
	// Documented trust boundary, not an accident: service_role is the one role that bypasses RLS,
	// so it must have no login and never appear in a browser or a request path.
	{
		// Checked on the real server only: PGlite (any 0.5.x build) does not honour BYPASSRLS the
		// way Postgres on disk does, so this probe returns the RLS-filtered count there. Testing it
		// against CI's PostgreSQL 17 is the authoritative run; the vitest host skips it explicitly
		// rather than asserting a value that would encode an in-process quirk as the spec.
		requiresBypassRls: true,
		name: 'service_role is the sole BYPASSRLS role and sees both orgs',
		role: 'service_role',
		claim: null,
		probe: 'SELECT count(*) FROM labels',
		expect: '2'
	}
];

/**
 * The statement the app uses to assume a role and scope a request — the same two `set_config`
 * calls as `src/lib/server/db/scoped.ts`, transaction-local so nothing leaks to the next case.
 *
 * @param {string} role
 * @param {string | null} claim the subject the app would put in request.jwt.claim.sub, or null
 *   for a request with no session at all.
 */
export function assumeSql(role, claim) {
	const sets = [`set_config('role', '${role}', true)`];
	if (claim === null) {
		sets.push(`set_config('request.jwt.claim.sub', '', true)`);
	} else {
		sets.push(`set_config('request.jwt.claim.sub', '${claim}', true)`);
	}
	return `SELECT ${sets.join(', ')}`;
}
