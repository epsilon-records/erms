import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { config as workerConfig } from '../../../netlify/functions/audiokit-worker.mjs';
import reconcile, {
	config as reconcileConfig
} from '../../../netlify/functions/audiokit-reconcile.mjs';

const SITE_URL = 'https://erms.epsilonrecords.test';
const SECRET = 'worker-secret-under-test';

/** Records the request each scheduled function makes and answers 200. */
function captureRequests() {
	const calls: { url: URL; init?: RequestInit }[] = [];
	vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
		calls.push({ url: new URL(String(input)), init });
		return new Response(JSON.stringify({ processed: 0 }), {
			status: 200,
			headers: { 'content-type': 'application/json' }
		});
	});
	return calls;
}

/** Headers of a POST as a plain object, whichever shape the function passed. */
function headersOf(call: { init?: RequestInit }): Record<string, string> {
	const { headers } = call.init ?? {};
	if (headers instanceof Headers) return Object.fromEntries(headers.entries());
	if (Array.isArray(headers)) return Object.fromEntries(headers);
	return { ...(headers as Record<string, string>) };
}

describe('AudioKit scheduled functions', () => {
	beforeEach(() => {
		process.env.URL = SITE_URL;
		process.env.WORKER_SECRET = SECRET;
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		delete process.env.URL;
		delete process.env.WORKER_SECRET;
	});

	it('sends the bearer secret and a same-origin header to the worker route', async () => {
		const calls = captureRequests();
		await worker();

		expect(calls).toHaveLength(1);
		expect(calls[0].url.pathname).toBe('/api/audiokit/worker');
		expect(calls[0].url.origin).toBe(SITE_URL);
		expect(calls[0].init?.method).toBe('POST');
		expect(headersOf(calls[0])).toMatchObject({
			authorization: `Bearer ${SECRET}`,
			// Regression: SvelteKit's CSRF guard answers 403 "Cross-site POST form submissions
			// are forbidden" for a POST with neither a matching `origin` nor a JSON content-type,
			// so the schedule never reached the route's own bearer check.
			origin: SITE_URL
		});
	});

	it('sends the bearer secret and a same-origin header to the reconcile route', async () => {
		const calls = captureRequests();
		await reconcile();

		expect(calls).toHaveLength(1);
		expect(calls[0].url.pathname).toBe('/api/audiokit/reconcile');
		expect(headersOf(calls[0])).toMatchObject({
			authorization: `Bearer ${SECRET}`,
			origin: SITE_URL
		});
	});

	it('fails loudly when the route rejects the call', async () => {
		vi.stubGlobal('fetch', async () => new Response('forbidden', { status: 403 }));
		await expect(worker()).rejects.toThrow(/HTTP 403/);
	});

	it('refuses to run without a configured worker secret', async () => {
		delete process.env.WORKER_SECRET;
		await expect(worker()).rejects.toThrow(/WORKER_SECRET/);
		await expect(reconcile()).rejects.toThrow(/WORKER_SECRET/);
	});

	it('keeps the intervals decision 0013 settled', () => {
		expect(workerConfig.schedule).toBe('* * * * *');
		expect(reconcileConfig.schedule).toBe('*/15 * * * *');
	});
});
