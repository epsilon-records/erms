import { it, expect, vi } from 'vitest';
import { createReceiver } from './app-metrics';
import { METRICS_ORIGIN } from '#lib/app-metrics-contract.js';
import type { Scoped } from './db/scoped';
const body = JSON.stringify({ v: 1, route: 'catalog_home', metric: 'document_mount_ms', ms: 420 });
const headers = {
	origin: METRICS_ORIGIN,
	'sec-fetch-site': 'same-origin',
	'content-type': 'application/json'
};
function req(options: RequestInit = {}) {
	return new Request(METRICS_ORIGIN + '/api/app-metrics', {
		method: 'POST',
		body,
		headers,
		...options
	});
}
const runSpy = vi.fn<Scoped>(async (fn) =>
	fn({ execute: vi.fn().mockResolvedValue([{ accepted: true }]) } as never)
);
const run = runSpy as Scoped;
it('disabled does not read body or run SQL', async () => {
	runSpy.mockClear();
	expect((await createReceiver()(req(), run, false)).status).toBe(204);
	expect(run).not.toHaveBeenCalled();
});
it('accepts finite body only, no response metadata or logs', async () => {
	const logs = vi.spyOn(console, 'error');
	const response = await createReceiver()(req(), run, true);
	expect(response.status).toBe(204);
	expect([...response.headers]).toEqual([['cache-control', 'no-store']]);
	expect(await response.text()).toBe('');
	expect(logs).not.toHaveBeenCalled();
	logs.mockRestore();
});
it('rejects unknown fields/UTF8/streaming overflow, headers/origins/media/method', async () => {
	const cases: [Request, number][] = [
		[req({ method: 'GET', body: undefined }), 405],
		[req({ body: body.slice(0, -1) + ',"token":"FAKE"}' }), 400],
		[req({ body: new Uint8Array([255]) }), 400],
		[req({ body: ' '.repeat(257) }), 413],
		[req({ headers: { ...headers, 'content-length': '257' } }), 413],
		[req({ headers: { ...headers, 'content-type': 'text/plain' } }), 415],
		[req({ headers: { ...headers, 'content-encoding': 'gzip' } }), 415],
		[new Request(METRICS_ORIGIN + '/api/app-metrics?FAKE', { method: 'POST', body, headers }), 400]
	];
	for (const key of [
		'cookie',
		'authorization',
		'proxy-authorization',
		'referer',
		'baggage',
		'sentry-trace',
		'traceparent',
		'tracestate',
		'x-forwarded-authorization',
		'x-session-id',
		'x-auth-token',
		'x-tenant-id'
	])
		cases.push([req({ headers: { ...headers, [key]: 'FAKE' } }), 403]);
	for (const origin of ['', 'null', 'https://attacker.invalid'])
		cases.push([req({ headers: { ...headers, origin } }), 403]);
	for (const [request, status] of cases) {
		const spy = vi.fn() as unknown as Scoped;
		const response = await createReceiver()(request, spy, true);
		expect(response.status).toBe(status);
		expect(await response.text()).toBe('');
		expect(spy).not.toHaveBeenCalled();
	}
});
it('limits process rate and concurrent ingestion before SQL', async () => {
	let clock = 0;
	const receive = createReceiver(() => clock);
	const disabledRun = vi.fn() as unknown as Scoped;
	for (let i = 0; i < 5; i++)
		expect((await receive(req({ body: '{}' }), disabledRun, true)).status).toBe(400);
	expect((await receive(req(), disabledRun, true)).status).toBe(429);
	clock = 2000;
	expect((await receive(req(), run, true)).status).toBe(204);
	let release!: () => void;
	const blocked: Scoped = async () => {
		await new Promise<void>((r) => (release = r));
		return [] as never;
	};
	const r = createReceiver();
	const first = r(req(), blocked, true);
	const second = r(req(), run, true);
	expect((await r(req(), run, true)).status).toBe(429);
	await vi.waitFor(() => expect(release).toBeTypeOf('function'));
	release();
	await first;
	await second;
});
it('maps cap and failures to empty responses without logging', async () => {
	const cap: Scoped = async () => false as never;
	const fail: Scoped = async () => {
		throw new Error('FAKE_SECRET');
	};
	expect((await createReceiver()(req(), cap, true)).status).toBe(429);
	expect((await createReceiver()(req(), fail, true)).status).toBe(503);
});

it('cancels slow and truly oversized streamed bodies, without opening SQL', async () => {
	const oversized = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new Uint8Array(257));
			controller.close();
		}
	});
	const request = req({ body: oversized, duplex: 'half' } as RequestInit);
	expect(request.headers.has('content-length')).toBe(false);
	const spy = vi.fn() as unknown as Scoped;
	expect((await createReceiver()(request, spy, true)).status).toBe(413);
	vi.useFakeTimers();
	try {
		const cancel = vi.fn();
		const slow = new ReadableStream<Uint8Array>({ cancel });
		const pending = createReceiver()(req({ body: slow, duplex: 'half' } as RequestInit), spy, true);
		await vi.advanceTimersByTimeAsync(1001);
		expect((await pending).status).toBe(503);
		expect(cancel).toHaveBeenCalledTimes(1);
		expect(spy).not.toHaveBeenCalled();
	} finally {
		vi.useRealTimers();
	}
});

it('rejects transport tracing outside the trusted Netlify boundary', async () => {
	const request = req({ headers: { ...headers, 'x-amzn-trace-id': 'Root=FAKE_TRANSPORT_ONLY' } });
	const response = await createReceiver()(request, run, true);
	expect(response.status).toBe(403);
	expect(response.headers.get('cache-control')).toBe('no-store');
	expect(await response.text()).toBe('');
});

it('uses fixed rejection categories without reflecting untrusted header values', async () => {
	const response = await createReceiver()(
		req({ headers: { ...headers, origin: 'https://FAKE_SECRET.invalid' } }),
		run,
		true
	);
	expect(response.status).toBe(403);
	expect(response.headers.get('x-app-metrics-rejection')).toBe('origin');
	expect(await response.text()).toBe('');
	expect([...response.headers].join(' ')).not.toContain('FAKE_SECRET');
});
