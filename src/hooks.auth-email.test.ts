import { expect, it, vi } from 'vitest';

// The Send Email hook path gets the labelkit_auth_email runner and nothing else: no cookies, no
// Supabase Auth call, no owner connection, no branding lookup (EPSILON-147).
const spies = vi.hoisted(() => ({
	auth: vi.fn(() => ({ auth: { getUser: async () => ({ data: { user: null } }) } })),
	ownerDb: vi.fn(() => {
		throw new Error('owner DB forbidden');
	}),
	authEmailRunner: vi.fn(() => vi.fn())
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
	authEmailRunner: spies.authEmailRunner
}));
import { handle } from './hooks.server';

function event(path: string) {
	const url = new URL(path, 'https://labelkit.co');
	return {
		url,
		request: new Request(url, { method: 'POST', body: '{}' }),
		cookies: { getAll: () => [], get: () => undefined, set: vi.fn() },
		locals: {} as Record<string, unknown>
	};
}

it('hands the exact hook path only the restricted runner, before Auth and cookies', async () => {
	const e = event('/api/auth/send-email');
	const resolve = vi.fn(async () => new Response('{}', { status: 200 }));
	expect((await handle({ event: e, resolve } as never)).status).toBe(200);
	expect(spies.authEmailRunner).toHaveBeenCalledTimes(1);
	expect(e.locals.db).toBe(spies.authEmailRunner.mock.results[0].value);
	expect(spies.auth).not.toHaveBeenCalled();
	expect(spies.ownerDb).not.toHaveBeenCalled();
	expect(e.locals).not.toHaveProperty('user');
});

it('does not open the hook boundary to other paths under it', async () => {
	spies.authEmailRunner.mockClear();
	for (const path of ['/api/auth/send-email/extra', '/api/auth/send-emails', '/api/auth/']) {
		await expect(
			handle({ event: event(path), resolve: async () => new Response() } as never)
		).rejects.toMatchObject({ status: 303, location: '/login' });
	}
	expect(spies.authEmailRunner).not.toHaveBeenCalled();
});
