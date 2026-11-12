// Daily: delete labels whose 30-day grace period after closing has ended (migration 0027).
export default async () => {
	const siteUrl = process.env.URL;
	const workerSecret = process.env.WORKER_SECRET;
	if (!siteUrl || !workerSecret) {
		throw new Error('Netlify URL and WORKER_SECRET are required to purge closed labels');
	}
	const response = await fetch(new URL('/api/internal/purge-orgs', siteUrl), {
		method: 'POST',
		// Same-origin `origin` header: see audiokit-worker.mjs.
		headers: { authorization: `Bearer ${workerSecret}`, origin: siteUrl },
		signal: AbortSignal.timeout(25_000)
	});
	if (!response.ok) throw new Error(`Purge returned HTTP ${response.status}`);
	console.log('Purge completed', await response.json());
};

export const config = { schedule: '17 3 * * *' };
