import { it, expect, vi } from 'vitest';
const spies = vi.hoisted(() => ({
	auth: vi.fn(() => ({ auth: { getUser: async () => ({ data: { user: null } }) } })),
	sentry: vi.fn(),
	runner: vi.fn(() => vi.fn())
}));
vi.mock('@sveltejs/kit/hooks', () => ({
	sequence:
		(...handlers: ((input: never) => unknown)[]) =>
		async (input: { event: unknown; resolve: (event: unknown) => unknown }) => {
			const dispatch = (index: number): unknown =>
				index === handlers.length
					? input.resolve(input.event)
					: handlers[index]({ event: input.event, resolve: () => dispatch(index + 1) } as never);
			return dispatch(0);
		}
}));
vi.mock('@supabase/ssr', () => ({ createServerClient: spies.auth }));
vi.mock('$app/env/private', () => ({ SENTRY_DSN: 'https://fake@example.invalid/1' }));
vi.mock('@sentry/sveltekit', () => ({
	init: vi.fn(),
	httpIntegration: vi.fn(),
	suppressTracing: (fn: () => unknown) => fn(),
	sentryHandle:
		() =>
		async ({ event, resolve }: { event: unknown; resolve: (event: unknown) => unknown }) => {
			spies.sentry();
			return resolve(event);
		},
	handleErrorWithSentry: (fn: unknown) => fn
}));
vi.mock('#lib/server/db/client.js', () => ({
	db: vi.fn(() => {
		throw new Error('owner DB forbidden');
	}),
	metricsRunner: spies.runner
}));
import { handle, handleError } from './hooks.server';
function event(path: string, authorization?: string) {
	const url = new URL(path, 'https://erms.epsilonrecords.com');
	return {
		url,
		request: new Request(url, { method: 'POST', headers: authorization ? { authorization } : {} }),
		cookies: { getAll: () => [], get: () => undefined },
		locals: {}
	} as never;
}
it('exact anonymous endpoint initializes only restricted execution and bypasses Auth/Sentry', async () => {
	spies.auth.mockClear();
	spies.sentry.mockClear();
	spies.runner.mockClear();
	const e = event('/api/app-metrics');
	const resolve = vi.fn(async () => new Response(null, { status: 204 }));
	expect((await handle({ event: e, resolve } as never)).status).toBe(204);
	expect(spies.runner).toHaveBeenCalledWith('labelkit_metrics_ingest');
	expect(spies.auth).not.toHaveBeenCalled();
	expect(spies.sentry).not.toHaveBeenCalled();
	expect((e as { locals: object }).locals).not.toHaveProperty('user');
});
it('does not widen ordinary auth permission to prefixes', async () => {
	for (const path of [
		'/api/app-metrics/extra',
		'/api/app-metrics-evil',
		'/api/internal/app-metrics-prune/extra'
	])
		await expect(
			handle({ event: event(path), resolve: async () => new Response() } as never)
		).rejects.toMatchObject({ status: 303, location: '/login' });
});
it('maintenance requires existing machine secret before runner initialization', async () => {
	spies.runner.mockClear();
	const e = event('/api/internal/app-metrics-prune');
	expect((await handle({ event: e, resolve: vi.fn() } as never)).status).toBe(401);
	expect(spies.runner).not.toHaveBeenCalled();
	vi.stubEnv('WORKER_SECRET', 'FAKE_METRICS_WORKER_SECRET');
	expect(
		(
			await handle({
				event: event('/api/internal/app-metrics-prune', 'Bearer FAKE_METRICS_WORKER_SECRET'),
				resolve: async () => new Response(null, { status: 204 })
			} as never)
		).status
	).toBe(204);
	expect(spies.runner).toHaveBeenCalledWith('labelkit_metrics_prune');
	vi.unstubAllEnvs();
});
it('catches resolve failures without request/error logging or Sentry forwarding', async () => {
	const logger = vi.spyOn(console, 'error');
	const response = await handle({
		event: event('/api/app-metrics'),
		resolve: async () => {
			throw new Error('FAKE_SECRET');
		}
	} as never);
	expect(response.status).toBe(503);
	expect(await response.text()).toBe('');
	expect(logger).not.toHaveBeenCalled();
	expect(
		handleError({ event: event('/api/app-metrics'), error: new Error('FAKE_SECRET') } as never)
	).toEqual({ message: 'Unavailable' });
	logger.mockRestore();
});

it('discards only hosting trace context for the exact server-verified Netlify metrics boundary', async () => {
	for (const trusted of [true, false]) {
		const headers = {
			origin: 'https://erms.epsilonrecords.com',
			'sec-fetch-site': 'same-origin',
			traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01',
			tracestate: 'fake=transport',
			'x-amzn-trace-id': 'FAKE_TRANSPORT',
			'x-nf-trace-span-id': 'FAKE_PLATFORM_SPAN',
			baggage: 'FAKE_MUST_REMAIN_REJECTED',
			authorization: 'FAKE_MUST_REMAIN_REJECTED'
		};
		const e = {
			url: new URL('https://erms.epsilonrecords.com/api/app-metrics'),
			request: new Request('https://erms.epsilonrecords.com/api/app-metrics', {
				method: 'POST',
				headers,
				body: '{}'
			}),
			locals: {},
			platform: {
				context: { site: { id: trusted ? '4d4e8994-934f-4d38-9eb6-5831c09fc6b1' : 'not-the-host' } }
			}
		};
		const resolve = vi.fn(async (received: typeof e) => {
			for (const key of ['traceparent', 'tracestate', 'x-amzn-trace-id', 'x-nf-trace-span-id'])
				expect(received.request.headers.has(key)).toBe(!trusted);
			expect(received.request.headers.get('authorization')).toBe('FAKE_MUST_REMAIN_REJECTED');
			expect(received.request.headers.get('baggage')).toBe('FAKE_MUST_REMAIN_REJECTED');
			expect(await received.request.text()).toBe('{}');
			return new Response(null, { status: 204 });
		});
		expect((await handle({ event: e, resolve } as never)).status).toBe(204);
		expect(resolve).toHaveBeenCalledTimes(1);
	}
});
