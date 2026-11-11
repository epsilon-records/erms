import { describe, expect, it, vi } from 'vitest';

// The hook builds a Supabase client on every request; the tests only care about the
// unauthenticated path, so a client that reports no user is enough.
vi.mock('@supabase/ssr', () => ({
	createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } })
}));

/** Minimal `event` for the hook: an unauthenticated browser request to `pathname`. */
function requestEvent(pathname: string) {
	const url = new URL(pathname, 'https://erms.test');
	return {
		url,
		request: new Request(url),
		cookies: { getAll: () => [], get: () => undefined, set: () => {} },
		locals: {}
	} as never;
}

async function runHook(pathname: string) {
	const { handle } = await import('./hooks.server.js');
	let resolved = false;
	const response = await handle({
		event: requestEvent(pathname),
		resolve: async () => {
			resolved = true;
			return new Response('ok');
		}
	} as never);
	return { response, resolved };
}

describe('auth hook allowlist', () => {
	it.each([
		'/api/audiokit/worker',
		'/api/audiokit/webhook',
		'/api/audiokit/reconcile',
		'/api/audiokit/webhook/client-123'
	])(
		'lets the machine endpoint %s reach its handler without a Supabase user',
		async (pathname) => {
			const { response, resolved } = await runHook(pathname);
			expect(resolved).toBe(true);
			expect(response.status).toBe(200);
			// Security headers are still applied to machine responses.
			expect(response.headers.get('X-Frame-Options')).toBe('DENY');
			expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
		}
	);

	it('serves the LabelKit landing page at / without a Supabase user', async () => {
		const { resolved } = await runHook('/');
		expect(resolved).toBe(true);
	});

	it.each([
		'/login',
		'/signup',
		'/signup/label',
		'/privacy',
		'/terms',
		'/auth/callback',
		'/auth/confirm'
	])('serves %s without a Supabase user', async (pathname) => {
		const { resolved } = await runHook(pathname);
		expect(resolved).toBe(true);
	});

	it.each([
		'/dashboard',
		'/api/recordings',
		'/api/audiokit',
		'/api/audiokit/',
		'/api/audiokit/anything',
		'/api/audiokit/workerx',
		'/api/audiokit/worker/extra',
		'/api/audiokit/webhook/',
		'/api/audiokit/webhook/client-123/extra',
		'/loginx',
		'/login/extra',
		'/signupx',
		'/privacy-old',
		'/terms/old',
		'/auth/callbackx',
		'/auth/confirm/extra'
	])(
		'still redirects the unauthenticated app path %s to /login',
		async (pathname) => {
			await expect(runHook(pathname)).rejects.toMatchObject({ status: 303, location: '/login' });
		}
	);
});

describe('/v1 API auth', () => {
	it('answers 401 JSON, never a login redirect, without an API key', async () => {
		const { response, resolved } = await runHook('/v1/releases');
		expect(resolved).toBe(false);
		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({
			error: { code: 'unauthorized', message: 'Missing or invalid API key.' }
		});
	});
});

describe('isLandingRequest', () => {
	it('is public only at / on LabelKit hosts', async () => {
		const { isLandingRequest } = await import('#lib/server/landing.js');
		expect(isLandingRequest('/', { orgId: null })).toBe(true);
		expect(isLandingRequest('/releases', { orgId: null })).toBe(false);
		// A customer's branded domain keeps / behind sign-in.
		expect(isLandingRequest('/', { orgId: 'org-epsilon' })).toBe(false);
	});
});
