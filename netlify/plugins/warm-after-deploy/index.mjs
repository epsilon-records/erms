// Local build plugin: warm the SvelteKit server function right after a production deploy goes
// live, so the first real visitor doesn't wait for a cold start (EPSILON-192).
//
// A new instance takes about 5 s to start, and every production deploy starts new instances.
// Netlify runs `onSuccess` after the deploy is published, so these requests reach the new
// deploy. A few run in parallel because each one can only warm the instance that serves it.
//
// It never fails anything: `onSuccess` can't stop a deploy that is already live, and a slow or
// failed warm-up only means the next visitor gets the cold start, as before.

export const PATH = '/login';
export const PARALLEL = 4;
export const TIMEOUT_MS = 15_000;

/**
 * @typedef {{ fetch?: typeof globalThis.fetch, now?: () => number }} Deps
 * @typedef {{ status: number, ms: number, error?: undefined } | { error: string, ms: number, status?: undefined }} Result
 */

/**
 * One timed GET. Resolves to `{ status, ms }`, or `{ error, ms }`. Never rejects.
 * @param {string} url
 * @param {Deps} [deps]
 * @returns {Promise<Result>}
 */
export async function hit(url, { fetch = globalThis.fetch, now = () => Date.now() } = {}) {
	const started = now();
	try {
		const res = await fetch(url, {
			redirect: 'manual',
			headers: { 'user-agent': 'labelkit-warm-after-deploy' },
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
		// Drain the body so the connection is released.
		await res.arrayBuffer().catch(() => {});
		return { status: res.status, ms: now() - started };
	} catch (error) {
		return { error: error instanceof Error ? error.name : 'Error', ms: now() - started };
	}
}

/**
 * Warm `baseUrl` with PARALLEL requests. Returns one line per request, for the build log.
 * @param {string} baseUrl
 * @param {Deps} [deps]
 */
export async function warm(baseUrl, deps) {
	const url = new URL(PATH, baseUrl).toString();
	const results = await Promise.all(Array.from({ length: PARALLEL }, () => hit(url, deps)));
	return results.map((r, i) =>
		r.error
			? `warm ${i + 1}/${PARALLEL} ${url}: ${r.error} after ${r.ms} ms`
			: `warm ${i + 1}/${PARALLEL} ${url}: ${r.status} in ${r.ms} ms`
	);
}

/**
 * Production deploys only: previews and branch deploys aren't what visitors hit.
 * @param {Record<string, string | undefined>} [env]
 */
export function target(env = process.env) {
	return env.CONTEXT === 'production' && env.URL ? env.URL : null;
}

export const onSuccess = async () => {
	const url = target();
	if (!url) {
		console.log('warm-after-deploy: not a production deploy, skipped');
		return;
	}
	for (const line of await warm(url)) console.log(`warm-after-deploy: ${line}`);
};
