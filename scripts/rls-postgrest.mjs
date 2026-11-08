/**
 * RLS through Supabase's own API, not through SQL.
 *
 * Why a third host when the SQL cases already run twice: the browser does not execute SQL. It asks
 * PostgREST, which sets the request role and the JWT claims that `app.current_user_id()` reads. Two
 * facts about production only become visible on that path:
 *  - Supabase grants `anon`/`authenticated` INSERT, UPDATE and DELETE on every migrated table, so
 *    privileges do not stop a REST write — only the row-level security policies do. A fixture that
 *    hands out SELECT alone cannot show that, and an earlier revision of this suite did exactly
 *    that and passed.
 *  - a delete matching nothing answers `204`, not an error. Asserting the status code alone would
 *    let a real deletion pass, so the case asserts the row survives.
 *
 * Runs against the local Supabase stack (the CI `rls-supabase` job, or `supabase start` locally).
 * Everything comes from env so nothing here is guesswork about versions or keys.
 */
import { createHmac } from 'node:crypto';
import postgres from 'postgres';

const API_URL = process.env.SUPABASE_API_URL ?? 'http://127.0.0.1:54321';
const DB_URL =
	process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
// The local stack's signing secret is a documented shared default — Supabase prints
// "API keys and JWT secrets are shared defaults. Do not use in production" on start — and this
// script never reads a running site's keys, so a CLI version that stops printing them (v3 did)
// cannot break the tests. Overridable by env for anything that has them.
const JWT_SECRET =
	process.env.JWT_SECRET ?? 'super-secret-jwt-token-with-at-least-32-characters-long';

const IDS = {
	orgA: 'a0000000-0000-4000-8000-00000000000a',
	orgB: 'b0000000-0000-4000-8000-00000000000b',
	labelA: 'c0000000-0000-4000-8000-00000000000c',
	labelB: 'd0000000-0000-4000-8000-00000000000d',
	u1: '11111111-1111-4111-8111-111111111111',
	u2: '22222222-2222-4222-8222-222222222222'
};

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** Mint a token the way Supabase does: same secret, same `role` and `sub` claims. */
function jwt(role, sub) {
	const head = b64({ alg: 'HS256', typ: 'JWT' });
	const body = b64({
		role,
		sub,
		iss: 'supabase-demo',
		aud: role,
		exp: Math.floor(Date.now() / 1000) + 3600
	});
	const sig = createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url');
	return `${head}.${body}.${sig}`;
}

const rest = `${API_URL}/rest/v1`;
const call = async (method, path, key, body) => {
	const response = await fetch(`${rest}${path}`, {
		method,
		headers: {
			apikey: key,
			Authorization: `Bearer ${key}`,
			'content-type': 'application/json',
			...(body ? { prefer: 'return=representation' } : {})
		},
		body: body ? JSON.stringify(body) : undefined
	});
	const text = await response.text();
	let parsed = text;
	try {
		parsed = JSON.parse(text);
	} catch {
		/* plain text bodies (errors from proxies, empty 204) are compared as strings */
	}
	return { status: response.status, body: parsed };
};

// Seed directly, then tell PostgREST the schema changed: migrations do not notify it on their own.
const sql = postgres(DB_URL, { max: 1 });
await sql`DELETE FROM labels WHERE id IN (${IDS.labelA}, ${IDS.labelB})`;
await sql`DELETE FROM memberships WHERE user_id IN (${IDS.u1}, ${IDS.u2})`;
await sql`DELETE FROM orgs WHERE id IN (${IDS.orgA}, ${IDS.orgB})`;
await sql`INSERT INTO orgs (id, name, slug) VALUES
		(${IDS.orgA}, 'Alpha Records', 'rls-verify-alpha'),
		(${IDS.orgB}, 'Beta Records', 'rls-verify-beta')`;
await sql`INSERT INTO memberships (org_id, user_id, role) VALUES
		(${IDS.orgA}, ${IDS.u1}, 'owner'),
		(${IDS.orgB}, ${IDS.u2}, 'owner')`;
await sql`INSERT INTO labels (id, org_id, name) VALUES
		(${IDS.labelA}, ${IDS.orgA}, 'Alpha Sound'),
		(${IDS.labelB}, ${IDS.orgB}, 'Beta Sound')`;
await sql`SELECT pg_notify('pgrst', 'reload schema')`;
await sql.end();

const userJwt = jwt('authenticated', IDS.u1);
// Minted rather than read from the stack: verified above that a token signed with the local secret
// is accepted in both `apikey` and `Authorization`, which is what makes this portable across CLI
// versions that print keys and ones that do not.
const ANON_KEY = process.env.ANON_KEY ?? jwt('anon', null);
const SERVICE_KEY = process.env.SERVICE_ROLE_KEY ?? jwt('service_role', null);
console.log(`API ${API_URL}  (roles: anon, authenticated, service_role — all minted locally)\n`);

const cases = [
	{
		name: 'anon key reads nothing',
		expect: '200 and 0 rows',
		run: async () => {
			const r = await call('GET', '/labels?select=name', ANON_KEY);
			return r.status === 200 && Array.isArray(r.body) && r.body.length === 0;
		}
	},
	{
		name: 'a user JWT reads its own org through the public read policies',
		expect: 'exactly Alpha Sound',
		run: async () => {
			const r = await call('GET', '/labels?select=name', userJwt);
			return r.status === 200 && r.body.length === 1 && r.body[0].name === 'Alpha Sound';
		}
	},
	{
		name: 'a user JWT cannot read another org by filter',
		expect: '0 rows',
		run: async () => {
			const r = await call('GET', `/labels?select=name&org_id=eq.${IDS.orgB}`, userJwt);
			return r.status === 200 && r.body.length === 0;
		}
	},
	{
		name: 'a user JWT cannot read another org even by primary key',
		expect: '0 rows',
		run: async () => {
			const r = await call('GET', `/labels?select=name&id=eq.${IDS.labelB}`, userJwt);
			return r.status === 200 && r.body.length === 0;
		}
	},
	{
		name: 'a user JWT cannot insert into its own org (holds INSERT, no policy)',
		expect: '403 from row-level security',
		run: async () => {
			const r = await call('POST', '/labels', userJwt, { org_id: IDS.orgA, name: 'via rest' });
			return r.status >= 400 && /row-level security/i.test(JSON.stringify(r.body));
		}
	},
	{
		name: 'a user JWT cannot insert into another org either',
		expect: '4xx',
		run: async () => {
			const r = await call('POST', '/labels', userJwt, { org_id: IDS.orgB, name: 'sneaked' });
			return r.status >= 400;
		}
	},
	{
		name: 'a user JWT cannot delete: 204 with nothing deleted, row survives',
		expect: '204 and the row still there',
		run: async () => {
			const r = await call('DELETE', `/labels?id=eq.${IDS.labelA}`, userJwt);
			const after = await call('GET', `/labels?select=name&id=eq.${IDS.labelA}`, SERVICE_KEY);
			return r.status === 204 && Array.isArray(after.body) && after.body.length === 1;
		}
	},
	{
		name: 'the org survived every attempt above',
		expect: 'Alpha Sound and Beta Sound both intact',
		run: async () => {
			const r = await call('GET', '/labels?select=name&order=name', SERVICE_KEY);
			return (
				r.status === 200 &&
				r.body.length === 2 &&
				r.body.every((row) => !['via rest', 'sneaked'].includes(row.name))
			);
		}
	},
	{
		name: 'service_role bypasses RLS and reads both orgs',
		expect: '2 rows',
		run: async () => {
			const r = await call('GET', '/labels?select=name', SERVICE_KEY);
			return r.status === 200 && r.body.length === 2;
		}
	},
	{
		name: 'a tampered token is refused outright',
		expect: '401',
		run: async () => {
			const r = await call('GET', '/labels?select=name', `${userJwt}x`);
			return r.status === 401;
		}
	}
];

let failed = 0;
for (const testCase of cases) {
	let passed = false;
	let detail = '';
	try {
		passed = await testCase.run();
	} catch (error) {
		detail = String(error.message ?? error);
	}
	if (!passed) failed += 1;
	console.log(
		`${passed ? 'ok  ' : 'FAIL'}  ${testCase.name.padEnd(58)} expect ${testCase.expect}` +
			(passed ? '' : detail ? `\n        ${detail}` : '')
	);
}

const cleanup = postgres(DB_URL, { max: 1 });
await cleanup`DELETE FROM labels WHERE id IN (${IDS.labelA}, ${IDS.labelB})`;
await cleanup`DELETE FROM memberships WHERE user_id IN (${IDS.u1}, ${IDS.u2})`;
await cleanup`DELETE FROM orgs WHERE id IN (${IDS.orgA}, ${IDS.orgB})`;
await cleanup.end();

console.log(`\n${cases.length - failed}/${cases.length} PostgREST cases passed`);
process.exit(failed ? 1 : 0);
