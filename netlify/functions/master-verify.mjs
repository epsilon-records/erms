import { siteUrlFor } from '../lib/site-url.mjs';

/**
 * Every minute: lease the masters waiting to be checked (EPSILON-120) and hand them to the
 * master-verify-background function, which streams each one from R2. The lease is taken by
 * POST /api/internal/verify-masters, so a master already being read is not handed out twice,
 * and one whose check never reported back is leased again once its lease runs out.
 *
 * @param {Request} [req]
 * @param {{ deploy?: { context?: string; id?: string }; fetchImpl?: typeof fetch }} [context]
 */
export default async (req, context = {}) => {
	const fetchImpl = context.fetchImpl ?? fetch;
	// On a deploy preview ("Run now"), call the preview, not production.
	const siteUrl = siteUrlFor(context);
	const workerSecret = process.env.WORKER_SECRET;
	if (!siteUrl || !workerSecret) {
		throw new Error('Netlify URL and WORKER_SECRET are required to check uploaded masters');
	}
	const headers = {
		authorization: `Bearer ${workerSecret}`,
		// Same-origin `origin` header: see audiokit-worker.mjs.
		origin: siteUrl,
		'content-type': 'application/json'
	};
	const claim = await fetchImpl(new URL('/api/internal/verify-masters', siteUrl), {
		method: 'POST',
		headers,
		body: '{}',
		// With the parallel starts below (10 s at most), the run stays under Netlify's 30 s limit.
		signal: AbortSignal.timeout(15_000)
	});
	if (!claim.ok) throw new Error(`Master check lease returned HTTP ${claim.status}`);
	const { jobs } = await claim.json();
	// One background invocation per master, all started at once, so each read gets the whole
	// 15 minutes and the run stays short. A master that could not be handed over keeps its lease
	// and is leased again once it runs out.
	const started = await Promise.allSettled(
		jobs.map((/** @type {unknown} */ job) =>
			fetchImpl(new URL('/.netlify/functions/master-verify-background', siteUrl), {
				method: 'POST',
				headers,
				body: JSON.stringify({ jobs: [job] }),
				signal: AbortSignal.timeout(10_000)
			})
		)
	);
	const failed = started.filter((s) => s.status !== 'fulfilled' || s.value.status !== 202).length;
	console.log('Master checks started', { site: siteUrl, count: jobs.length - failed, failed });
	if (failed) throw new Error(`${failed} background master checks could not be started`);
};

export const config = { schedule: '* * * * *' };
