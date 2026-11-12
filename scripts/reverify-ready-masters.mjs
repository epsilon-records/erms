#!/usr/bin/env node
// One-off re-check of masters that became ready before the server verified hashes (EPSILON-120).
// Until then a ready master's sha256 was the value the browser reported. This reads every ready
// master from R2 once, computes its SHA-256 and reports any whose bytes do not match the recorded
// hash, size or WAV header. It writes nothing: what to do about a mismatch is a person's call.
//
// Runs as the owner (it reads masters in every org), so it needs:
//   DATABASE_URL          owner connection string
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_MASTERS_BUCKET
//
//   node scripts/reverify-ready-masters.mjs            # exit 1 if any master does not match
//
// Point it at production only when asked to.
import { AwsClient } from 'aws4fetch';
import postgres from 'postgres';
import { inspectUrl, toHex } from '../netlify/lib/inspect-stream.mjs';

const WAV_HEADER_BYTES = 12;
const DEADLINE_MS = 30 * 60_000;

/** RIFF, RF64 or BW64, then WAVE: the same rule as src/lib/masters.ts isWavHeader. */
function isWavHeader(/** @type {Uint8Array} */ b) {
	if (b.length < WAV_HEADER_BYTES) return false;
	const ascii = (/** @type {number} */ from, /** @type {number} */ to) =>
		String.fromCharCode(...b.slice(from, to));
	return ['RIFF', 'RF64', 'BW64'].includes(ascii(0, 4)) && ascii(8, 12) === 'WAVE';
}

const env = (/** @type {string} */ name) => {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is required`);
	return value;
};

const sql = postgres(env('DATABASE_URL'), { prepare: false, max: 1 });
const client = new AwsClient({
	accessKeyId: env('R2_ACCESS_KEY_ID'),
	secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
	service: 's3',
	region: 'auto'
});
const base = `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com/${encodeURIComponent(env('R2_MASTERS_BUCKET'))}`;

/** A short-lived presigned GET, so the read itself needs no signing per request. */
async function signedGet(/** @type {string} */ key) {
	const url = new URL(`${base}/${key.split('/').map(encodeURIComponent).join('/')}`);
	url.searchParams.set('X-Amz-Expires', String(DEADLINE_MS / 1000));
	return (await client.sign(url.toString(), { method: 'GET', aws: { signQuery: true } })).url;
}

let checked = 0;
let problems = 0;
try {
	const rows = await sql`
		select id, org_id, object_key, size_bytes, sha256 from masters
		where status = 'ready' order by created_at`;
	for (const row of rows) {
		checked++;
		const report = { id: row.id, org: row.org_id, key: row.object_key };
		try {
			const read = await inspectUrl(await signedGet(row.object_key), {
				deadlineMs: DEADLINE_MS,
				headerBytes: WAV_HEADER_BYTES
			});
			const issues = [];
			if (read.sha256 !== row.sha256) issues.push('sha256 differs');
			if (read.size !== Number(row.size_bytes))
				issues.push(`size ${read.size}, recorded ${row.size_bytes}`);
			if (!isWavHeader(read.start)) issues.push(`not WAV (header ${toHex(read.start)})`);
			if (issues.length) {
				problems++;
				console.log(
					JSON.stringify({
						...report,
						result: 'mismatch',
						issues,
						stored: read.sha256,
						recorded: row.sha256
					})
				);
			} else {
				console.log(JSON.stringify({ ...report, result: 'ok' }));
			}
		} catch (e) {
			problems++;
			console.log(JSON.stringify({ ...report, result: 'unreadable', error: String(e) }));
		}
	}
} finally {
	await sql.end();
}
console.log(JSON.stringify({ checked, problems }));
process.exit(problems ? 1 : 0);
