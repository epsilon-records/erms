import { expect, it, vi } from 'vitest';

// api.labelkit.co answers the API and nothing else: no Supabase Auth, no cookies, no pages, no
// machine routes. labelkit.co still serves the OpenAPI document without a key.
const spies = vi.hoisted(() => ({
	auth: vi.fn(() => ({
		auth: {
			getSession: async () => ({ data: { session: null } }),
			getUser: async () => ({ data: { user: null } })
		}
	})),
	ownerDb: vi.fn(() => {
		throw new Error('owner DB forbidden');
	})
}));
vi.mock('@supabase/ssr', () => ({ createServerClient: spies.auth }));
vi.mock('$app/env/private', () => ({ SENTRY_DSN: undefined }));
vi.mock('@sentry/sveltekit', () => ({
	init: vi.fn(),
	httpIntegration: vi.fn(),
	suppressTracing: (fn: () => unknown) => fn(),
	sentryHandle: () => vi.fn(),
	handleErrorWithSentry: (fn: unknown) => fn
}));
vi.mock('#lib/server/db/client.js', () => ({
	db: spies.ownerDb,
	metricsRunner: vi.fn(),
	authEmailRunner: vi.fn()
}));
import { handle } from './hooks.server';

function event(href: string, headers: Record<string, string> = {}) {
	const url = new URL(href);
	return {
		url,
		request: new Request(url, { headers }),
		cookies: { getAll: () => [], get: () => undefined, set: vi.fn() },
		locals: {} as Record<string, unknown>
	};
}
const never = vi.fn(async () => new Response('page', { status: 200 }));

it('answers / on the API host with a JSON index', async () => {
	const res = await handle({ event: event('https://api.labelkit.co/'), resolve: never } as never);
	expect(res.status).toBe(200);
	expect(await res.json()).toMatchObject({ name: 'LabelKit API', version: 'v1' });
	expect(res.headers.get('strict-transport-security')).toBeTruthy();
	expect(never).not.toHaveBeenCalled();
});

it('is a JSON 404 for every app page and machine route on the API host', async () => {
	for (const path of [
		'/login',
		'/org/billing',
		'/api/auth/send-email',
		'/api/app-metrics',
		'/privacy'
	]) {
		const res = await handle({
			event: event(`https://api.labelkit.co${path}`),
			resolve: never
		} as never);
		expect(res.status, path).toBe(404);
		expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'Not found.' } });
	}
	expect(never).not.toHaveBeenCalled();
	expect(spies.auth).not.toHaveBeenCalled();
});

it('requires a Bearer key for /v1 on the API host and never reads cookies', async () => {
	const res = await handle({
		event: event('https://api.labelkit.co/v1/releases', { cookie: 'sb-access-token=x' }),
		resolve: never
	} as never);
	expect(res.status).toBe(401);
	expect(spies.auth).not.toHaveBeenCalled();
});

it('does not serve the API on labelkit.co or a custom domain: a plain 404', async () => {
	for (const href of [
		'https://labelkit.co/v1/releases',
		'https://labelkit.co/v1/openapi.yaml',
		'https://erms.epsilonrecords.com/v1/recordings'
	]) {
		const res = await handle({ event: event(href), resolve: never } as never);
		expect(res.status, href).toBe(404);
		expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'Not found.' } });
		expect(res.headers.get('location')).toBeNull();
	}
	expect(never).not.toHaveBeenCalled();
});

it('serves the OpenAPI document without a key on the API host and on previews', async () => {
	for (const host of [
		'api.labelkit.co',
		'deploy-preview-93--labelkit.netlify.app',
		'localhost:5173'
	]) {
		const resolve = vi.fn(async () => new Response('openapi: 3.1.0', { status: 200 }));
		const e = event(`https://${host}/v1/openapi.yaml`);
		const res = await handle({ event: e, resolve } as never);
		expect(res.status, host).toBe(200);
		expect(resolve).toHaveBeenCalledTimes(1);
		expect(e.locals.user).toBeNull();
	}
	expect(spies.auth).not.toHaveBeenCalled();
	expect(spies.ownerDb).not.toHaveBeenCalled();
});
