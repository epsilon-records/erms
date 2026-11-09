/** Retention remains active when ingestion is disabled; never log requests or credentials. */
export default async () => {
	const siteUrl = process.env.URL;
	const secret = process.env.WORKER_SECRET;
	if (!siteUrl || !secret) throw new Error('Metrics prune configuration missing');
	const response = await fetch(new URL('/api/internal/app-metrics-prune', siteUrl), {
		method: 'POST',
		headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
		redirect: 'error',
		signal: AbortSignal.timeout(2000)
	});
	if (!response.ok) throw new Error('Metrics prune unavailable');
};
export const config = { schedule: '10 0 * * *' };
