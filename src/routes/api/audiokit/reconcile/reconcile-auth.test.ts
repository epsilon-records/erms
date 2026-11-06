import { afterEach, describe, expect, it, vi } from 'vitest';

// The handler builds an AudioKit client after the auth check. Returning null makes an
// authorized request fail with 503, which proves it got past the 401 gate.
vi.mock('#lib/server/audio/client.js', () => ({
	createAudioKitClient: () => null
}));

const URL = 'https://erms.test/api/audiokit/reconcile';

function post(headers?: Record<string, string>) {
	return { request: new Request(URL, { method: 'POST', headers }) } as never;
}

describe('reconcile endpoint auth', () => {
	afterEach(() => vi.unstubAllEnvs());

	it('rejects a request without the worker bearer token', async () => {
		vi.stubEnv('WORKER_SECRET', 'test-worker-secret');
		const { POST } = await import('./+server.js');
		await expect(POST(post())).rejects.toMatchObject({ status: 401 });
	});

	it('rejects a request with the wrong worker bearer token', async () => {
		vi.stubEnv('WORKER_SECRET', 'test-worker-secret');
		const { POST } = await import('./+server.js');
		await expect(POST(post({ authorization: 'Bearer wrong' }))).rejects.toMatchObject({
			status: 401
		});
	});

	it('rejects every request when no worker secret is configured', async () => {
		vi.stubEnv('WORKER_SECRET', '');
		const { POST } = await import('./+server.js');
		await expect(POST(post({ authorization: 'Bearer test-worker-secret' }))).rejects.toMatchObject({
			status: 401
		});
	});

	it('lets a request with the correct bearer token past the auth gate', async () => {
		vi.stubEnv('WORKER_SECRET', 'test-worker-secret');
		const { POST } = await import('./+server.js');
		await expect(POST(post({ authorization: 'Bearer test-worker-secret' }))).rejects.toMatchObject({
			status: 503
		});
	});
});
