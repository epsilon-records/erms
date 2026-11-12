/**
 * Every minute: lease the masters waiting to be checked (EPSILON-120) and hand them to the
 * master-verify-background function, which streams each one from R2. The lease is taken by
 * POST /api/internal/verify-masters, so a master already being read is not handed out twice,
 * and one whose check never reported back is leased again once its lease runs out.
 */
/**
 * @param {Request} [_req]
 * @param {{ fetchImpl?: typeof fetch }} [deps]
 */
export default async (_req, { fetchImpl = fetch } = {}) => {
	const siteUrl = process.env.URL;
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
		signal: AbortSignal.timeout(25_000)
	});
	if (!claim.ok) throw new Error(`Master check lease returned HTTP ${claim.status}`);
	const { jobs } = await claim.json();
	// One background invocation per master, so each read gets the whole 15 minutes. A master
	// that could not be handed over keeps its lease and is leased again once it runs out.
	let failed = 0;
	for (const job of jobs) {
		const res = await fetchImpl(new URL('/.netlify/functions/master-verify-background', siteUrl), {
			method: 'POST',
			headers,
			body: JSON.stringify({ jobs: [job] }),
			signal: AbortSignal.timeout(10_000)
		}).catch(() => null);
		if (res?.status !== 202) failed++;
	}
	console.log('Master checks started', { count: jobs.length - failed, failed });
	if (failed) throw new Error(`${failed} background master checks could not be started`);
};

export const config = { schedule: '* * * * *' };
