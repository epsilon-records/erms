import { afterEach, expect, it, vi } from 'vitest';
import prune, { config } from '../../../netlify/functions/app-metrics-prune.mjs';
afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});
it('runs daily at 00:10 UTC using only the existing machine bearer pattern', async () => {
	vi.stubEnv('URL', 'https://fixture.invalid');
	vi.stubEnv('WORKER_SECRET', 'FAKE_PRUNE_SECRET');
	const fetch = vi
		.fn<typeof globalThis.fetch>()
		.mockResolvedValue(new Response(null, { status: 204 }));
	vi.stubGlobal('fetch', fetch);
	expect(config.schedule).toBe('10 0 * * *');
	await prune();
	const [url, options] = fetch.mock.calls[0];
	expect(String(url)).toBe('https://fixture.invalid/api/internal/app-metrics-prune');
	expect(options).toMatchObject({
		method: 'POST',
		headers: { authorization: 'Bearer FAKE_PRUNE_SECRET', 'content-type': 'application/json' },
		redirect: 'error'
	});
	expect(options).not.toHaveProperty('body');
});
it('fails closed with fixed errors and never exposes credentials or response bodies', async () => {
	const fetch = vi
		.fn<typeof globalThis.fetch>()
		.mockResolvedValue(new Response('FAKE_RESPONSE_SECRET', { status: 503 }));
	vi.stubGlobal('fetch', fetch);
	vi.stubEnv('URL', '');
	vi.stubEnv('WORKER_SECRET', 'FAKE_PRUNE_SECRET');
	await expect(prune()).rejects.toThrow('Metrics prune configuration missing');
	expect(fetch).not.toHaveBeenCalled();
	vi.stubEnv('URL', 'https://fixture.invalid');
	await expect(prune()).rejects.toThrow('Metrics prune unavailable');
});
