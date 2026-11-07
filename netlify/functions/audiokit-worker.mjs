export default async () => {
	const siteUrl = process.env.URL;
	const workerSecret = process.env.WORKER_SECRET;
	if (!siteUrl || !workerSecret) {
		throw new Error('Netlify URL and WORKER_SECRET are required to run the AudioKit worker');
	}

	const response = await fetch(new URL('/api/audiokit/worker', siteUrl), {
		method: 'POST',
		// `origin` is required, not decoration: SvelteKit's CSRF guard rejects a POST that has
		// neither a same-origin `origin` header nor a `content-type: application/json` body, and
		// answers 403 "Cross-site POST form submissions are forbidden" before the route's own
		// bearer-token check runs. A bare POST from a scheduled function has neither.
		headers: { authorization: `Bearer ${workerSecret}`, origin: siteUrl },
		signal: AbortSignal.timeout(25_000)
	});
	if (!response.ok) {
		throw new Error(`AudioKit worker returned HTTP ${response.status}`);
	}

	console.log('AudioKit worker completed', await response.json());
};

export const config = { schedule: '* * * * *' };
