export default async () => {
	const siteUrl = process.env.URL;
	const workerSecret = process.env.WORKER_SECRET;
	if (!siteUrl || !workerSecret) {
		throw new Error('Netlify URL and WORKER_SECRET are required to run the AudioKit worker');
	}

	const response = await fetch(new URL('/api/audiokit/worker', siteUrl), {
		method: 'POST',
		headers: { authorization: `Bearer ${workerSecret}` },
		signal: AbortSignal.timeout(25_000)
	});
	if (!response.ok) {
		throw new Error(`AudioKit worker returned HTTP ${response.status}`);
	}

	console.log('AudioKit worker completed', await response.json());
};

export const config = { schedule: '* * * * *' };
