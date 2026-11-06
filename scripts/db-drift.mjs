#!/usr/bin/env node
// Drift check (EPSILON-47): compares the migrations recorded in the target
// database with the repository's drizzle/ journal.
//
//   pnpm db:drift        # exit 1 when the database is behind
//   pnpm db:drift --warn # print a warning and exit 0
//
// The database records one row per applied migration in drizzle.__drizzle_migrations,
// keyed by the migration's content hash (drizzle's own identifier). We hash each
// drizzle/*.sql file the same way drizzle does and compare, so a database that has not
// received a merged migration shows up as "behind" instead of silently passing. A
// migration whose file changed after it was applied also shows up (hash mismatch).
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import postgres from 'postgres';

const warnOnly = process.argv.includes('--warn');
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const journal = JSON.parse(readFileSync(join(repoRoot, 'drizzle/meta/_journal.json'), 'utf8'));
const migrations = (journal.entries ?? []).map((entry) => ({
	idx: entry.idx,
	tag: entry.tag,
	hash: createHash('sha256')
		.update(readFileSync(join(repoRoot, 'drizzle', `${entry.tag}.sql`)))
		.digest('hex')
}));

const url = process.env.DATABASE_URL;
if (!url) {
	console.error('DATABASE_URL is not set; cannot compare the database with the repo journal.');
	process.exit(2);
}

// The Supabase transaction pooler (port 6543) needs prepared statements disabled.
const sql = postgres(url, { max: 1, prepare: false });

let exitCode = 0;
try {
	const [{ present }] = await sql`
		SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present
	`;
	const applied = present ? await sql`SELECT hash FROM drizzle.__drizzle_migrations` : [];

	const appliedHashes = new Set(applied.map((row) => String(row.hash)));
	const pending = migrations.filter((migration) => !appliedHashes.has(migration.hash));
	const known = new Set(migrations.map((migration) => migration.hash));
	const unknown = [...appliedHashes].filter((hash) => !known.has(hash));

	if (unknown.length > 0) {
		console.warn(
			`::warning::${unknown.length} migration(s) are applied to the database but not in ` +
				'drizzle/meta/_journal.json; the repo and database may have diverged.'
		);
	}

	if (pending.length === 0) {
		console.log(
			`Database is up to date: ${migrations.length} migration(s) applied` +
				(unknown.length > 0 ? `, ${unknown.length} unknown to the journal.` : '.')
		);
	} else {
		const detail = pending
			.map((migration) => `  ${String(migration.idx).padStart(4, '0')} ${migration.tag}`)
			.join('\n');
		const summary =
			`Database is behind the repo journal: ${pending.length} of ${migrations.length} ` +
			'migration(s) not applied.';
		if (warnOnly) {
			console.error(`::warning::${summary}`);
			console.error(`${summary}\n${detail}`);
		} else {
			console.error(`::error::${summary}`);
			console.error(`${summary}\n${detail}`);
			exitCode = 1;
		}
	}
} catch (error) {
	// Never echo the connection string if the driver puts it in the message.
	const message = error instanceof Error ? error.message : String(error);
	console.error(`Failed to check migrations: ${message.split(url).join('<DATABASE_URL>')}`);
	exitCode = 1;
} finally {
	await sql.end({ timeout: 5 });
}

process.exit(exitCode);
