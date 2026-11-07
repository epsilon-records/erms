export default async () => {
	const siteUrl = process.env.URL;
	const workerSecret = process.env.WORKER_SECRET;
	if (!siteUrl || !workerSecret) {
		throw new Error('Netlify URL and WORKER_SECRET are required to reconcile AudioKit jobs');
	}

	const response = await fetch(new URL('/api/audiokit/reconcile', siteUrl), {
		method: 'POST',
		// See audiokit-worker.mjs: without a same-origin `origin` header SvelteKit's CSRF guard
		// answers 403 before the route's bearer-token check runs.
		headers: { authorization: `Bearer ${workerSecret}`, origin: siteUrl },
		signal: AbortSignal.timeout(25_000)
	});
	if (!response.ok) {
		throw new Error(`AudioKit reconcile returned HTTP ${response.status}`);
	}

	console.log('AudioKit reconciliation completed', await response.json());
};

export const config = { schedule: '*/15 * * * *' };
