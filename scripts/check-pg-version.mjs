// PostgreSQL version discipline across the four places ERMS names it.
//
// Why: production is Supabase on PostgreSQL 17, local development uses `postgres:17` via
// docker-compose, and the tests and CI run on the local Supabase stack, whose major is pinned in
// supabase/config.toml. The Vitest suites once ran on in-process PGlite at 18.6 while every other
// place said 17, and no check noticed.
//
// The rule: README (the production claim), docker-compose (development), supabase/config.toml
// (tests and CI), and the server actually answering DATABASE_URL must name the same major. Any one
// of them moving alone fails this, locally and in CI.
//
// Run: DATABASE_URL=postgres://… pnpm db:pgversion   (CI does; see .github/workflows/ci.yml)
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

const sources = {
	// The stack table: "Database (PostgreSQL 17)".
	'README.md (what production runs)': read('README.md').match(/Database \(PostgreSQL (\d+)\)/)?.[1],
	'docker-compose.yml (what development runs)':
		read('docker-compose.yml').match(/image:\s*postgres:(\d+)/)?.[1],
	'supabase/config.toml (what the tests and CI run)': read('supabase/config.toml').match(
		/^major_version\s*=\s*(\d+)/m
	)?.[1]
};

const url = process.env.DATABASE_URL;
if (!url) {
	// No silent pass: without a server there is nothing to compare, and a check that skips on a
	// developer machine while quietly running in CI is how the last three of these drifted.
	console.error(
		'DATABASE_URL is not set, so the live server cannot be compared with the declared majors.\n' +
			'Local: start the compose database (`docker compose up -d`) and point DATABASE_URL at it,\n' +
			'or run `pnpm db:pgversion` inside CI, where the Supabase stack is always running.'
	);
	process.exit(2);
}

const sql = postgres(url, { max: 1, prepare: false });
let exitCode = 0;

try {
	const [{ num, full }] = await sql`
    SELECT current_setting('server_version_num')::int / 10000 AS num,
           current_setting('server_version') AS full
  `;
	sources['the live server behind DATABASE_URL'] = String(num);

	const declared = Object.entries(sources);
	const majors = new Set(declared.map(([, value]) => value));

	for (const [name, value] of declared) {
		console.log(`${value ?? 'MISSING'}\t${name}`);
	}
	console.log(`\nserver reports: ${full}`);

	if (majors.has(undefined) || majors.has('undefined')) {
		throw new Error(
			'one of the sources no longer names a PostgreSQL major — fix the pattern, do not delete the check'
		);
	}
	if (majors.size > 1) {
		throw new Error(
			`PostgreSQL majors disagree: ${[...majors].join(' vs ')}. ` +
				'CI must test the major production runs; the version pinned in each place is deliberate.'
		);
	}
	console.log(`\nOK: every source and the live server are PostgreSQL ${[...majors][0]}.`);
} catch (error) {
	console.error(`\nFAIL: ${error.message}`);
	exitCode = 1;
} finally {
	await sql.end({ timeout: 5 });
}

process.exit(exitCode);
