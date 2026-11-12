import { inspectUrl, isR2Url, isWorkerBearer, toHex } from '../lib/inspect-stream.mjs';
import { siteUrlFor } from '../lib/site-url.mjs';

/**
 * Background check of uploaded masters (EPSILON-120). A Netlify background function: the caller
 * gets 202 at once and this runs for up to 15 minutes, long enough to stream a 4 GiB master from
 * R2. It holds no database or R2 credentials. The scheduled master-verify function hands it
 * presigned GET URLs for masters it has leased, and it posts what it read back to
 * POST /api/internal/verify-masters, which decides.
 *
 * Every read has an overall deadline below the 15-minute limit. A read that fails or stalls is
 * reported as an error; the master stays `verifying` and is leased again on a later run.
 */

/** Tries for each result post, and the wait before each retry. */
export const POST_TRIES = 3;
export const POST_RETRY_MS = 2_000;

/**
 * POST one result to LabelKit, trying up to POST_TRIES times. Never throws.
 *
 * @param {typeof fetch} fetchImpl
 * @param {string} siteUrl
 * @param {string | undefined} workerSecret
 * @param {unknown} result
 * @returns {Promise<{ ok: boolean; status?: number | string }>}
 */
export async function postResult(
	fetchImpl,
	siteUrl,
	workerSecret,
	result,
	retryMs = POST_RETRY_MS
) {
	/** @type {number | string | undefined} */
	let status;
	for (let attempt = 1; attempt <= POST_TRIES; attempt++) {
		if (attempt > 1) await new Promise((r) => setTimeout(r, retryMs));
		try {
			const res = await fetchImpl(new URL('/api/internal/verify-masters', siteUrl), {
				method: 'POST',
				headers: {
					authorization: `Bearer ${workerSecret}`,
					origin: siteUrl,
					'content-type': 'application/json'
				},
				body: JSON.stringify({ results: [result] }),
				signal: AbortSignal.timeout(25_000)
			});
			if (res.ok) return { ok: true };
			status = res.status;
			// A 4xx will not change on a retry.
			if (res.status >= 400 && res.status < 500) break;
		} catch (e) {
			status = String(e);
		}
	}
	return { ok: false, status };
}

/** Below Netlify's 15-minute limit, with room to post the result. */
export const READ_DEADLINE_MS = 12 * 60_000;
const WAV_HEADER_BYTES = 12;

/**
 * @param {Request} req
 * @param {{ deploy?: { context?: string; id?: string }; fetchImpl?: typeof fetch; retryMs?: number }} [context]
 */
export default async (req, context = {}) => {
	const fetchImpl = context.fetchImpl ?? fetch;
	const workerSecret = process.env.WORKER_SECRET;
	if (!isWorkerBearer(req.headers.get('authorization'), workerSecret)) {
		return new Response(null, { status: 401 });
	}
	// On a deploy preview, report to the preview, never production.
	const siteUrl = siteUrlFor(context);
	if (!siteUrl) return new Response(null, { status: 500 });
	const { jobs } = await req.json().catch(() => ({ jobs: null }));
	if (!Array.isArray(jobs)) return new Response(null, { status: 400 });

	for (const job of jobs) {
		let result;
		try {
			if (!isR2Url(job.url)) throw new Error('not a storage URL');
			const read = await inspectUrl(job.url, {
				deadlineMs: READ_DEADLINE_MS,
				headerBytes: WAV_HEADER_BYTES,
				fetchImpl
			});
			result = {
				id: job.id,
				token: job.token,
				sha256: read.sha256,
				size: read.size,
				header: toHex(read.start)
			};
		} catch (e) {
			const status = /** @type {{ status?: unknown }} */ (e)?.status;
			result = {
				id: job.id,
				token: job.token,
				error: String(e).slice(0, 200),
				...(typeof status === 'number' ? { status } : {})
			};
		}
		// One post per master, so a slow master never holds back the others' results. A failed
		// post is retried a few times with the same result: dropping it would cost the master an
		// attempt, and throwing would make Netlify re-run the whole invocation.
		const recorded = await postResult(fetchImpl, siteUrl, workerSecret, result, context.retryMs);
		if (!recorded.ok) {
			console.error(
				JSON.stringify({
					level: 'error',
					msg: 'master check not recorded',
					id: job.id,
					status: recorded.status
				})
			);
		}
	}
	return new Response(null, { status: 204 });
};
