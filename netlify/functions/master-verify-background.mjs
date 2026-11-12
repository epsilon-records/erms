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

/** Below Netlify's 15-minute limit, with room to post the result. */
export const READ_DEADLINE_MS = 12 * 60_000;
const WAV_HEADER_BYTES = 12;

/**
 * @param {Request} req
 * @param {{ deploy?: { context?: string }; fetchImpl?: typeof fetch }} [context]
 */
export default async (req, context = {}) => {
	const fetchImpl = context.fetchImpl ?? fetch;
	// On a deploy preview, report to the preview, not production.
	const siteUrl = siteUrlFor(req, context);
	const workerSecret = process.env.WORKER_SECRET;
	if (!siteUrl || !isWorkerBearer(req.headers.get('authorization'), workerSecret)) {
		return new Response(null, { status: 401 });
	}
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
		// One post per master, so a slow master never holds back the others' results.
		const res = await fetchImpl(new URL('/api/internal/verify-masters', siteUrl), {
			method: 'POST',
			headers: {
				authorization: `Bearer ${workerSecret}`,
				origin: siteUrl,
				'content-type': 'application/json'
			},
			body: JSON.stringify({ results: [result] }),
			signal: AbortSignal.timeout(25_000)
		}).catch((e) => ({ ok: false, status: String(e) }));
		if (!res.ok) {
			console.error(
				JSON.stringify({
					level: 'error',
					msg: 'master check not recorded',
					id: job.id,
					status: res.status
				})
			);
		}
	}
	return new Response(null, { status: 204 });
};
