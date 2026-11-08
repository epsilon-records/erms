import { createServerClient } from '@supabase/ssr';
import { describe, expect, it, vi } from 'vitest';
import { GET } from './+server';

function event(search: string, exchangeCodeForSession = vi.fn()) {
	return {
		url: new URL(`/auth/callback${search}`, 'https://erms.epsilonrecords.com'),
		locals: { supabase: { auth: { exchangeCodeForSession } } }
	} as never;
}

describe('magic-link callback', () => {
	it('exchanges a code and removes it from the success redirect', async () => {
		const exchange = vi.fn().mockResolvedValue({ error: null });
		await expect(GET(event('?code=one-time-code', exchange))).rejects.toMatchObject({
			status: 303,
			location: '/?signed-in'
		});
		expect(exchange).toHaveBeenCalledWith('one-time-code');
	});

	it('removes a rejected code from the error redirect', async () => {
		const exchange = vi.fn().mockResolvedValue({ error: { code: 'flow_state_expired' } });
		await expect(GET(event('?code=spent-code', exchange))).rejects.toMatchObject({
			status: 303,
			location: '/login?link=invalid'
		});
	});

	it('does not exchange a missing code', async () => {
		const exchange = vi.fn();
		await expect(GET(event('', exchange))).rejects.toMatchObject({
			status: 303,
			location: '/login?link=invalid'
		});
		expect(exchange).not.toHaveBeenCalled();
	});

	it('rejects a code opened without the originating browser cookie before any token request', async () => {
		const fetcher = vi.fn();
		const supabase = createServerClient('https://example.supabase.co', 'test', {
			global: { fetch: fetcher },
			cookies: { getAll: () => [], setAll: () => {} }
		});
		await expect(
			GET({
				url: new URL('https://erms.epsilonrecords.com/auth/callback?code=test-code'),
				locals: { supabase }
			} as never)
		).rejects.toMatchObject({ status: 303, location: '/login?link=invalid' });
		expect(fetcher).not.toHaveBeenCalled();
	});

	it('persists the session through the real SSR cookie adapter after PKCE exchange', async () => {
		const jar = new Map<string, string>();
		const requests: { path: string; body: Record<string, string> }[] = [];
		const user = { id: '00000000-0000-0000-0000-000000000001', aud: 'authenticated' };
		const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = new URL(String(input));
			requests.push({ path: url.pathname, body: JSON.parse(String(init?.body ?? '{}')) });
			return new Response(
				JSON.stringify(
					url.pathname.endsWith('/otp')
						? {}
						: {
								access_token: 'test-access-token',
								refresh_token: 'test-refresh-token',
								token_type: 'bearer',
								expires_in: 3600,
								user
							}
				),
				{ headers: { 'Content-Type': 'application/json' } }
			);
		});
		const client = () =>
			createServerClient('https://example.supabase.co', 'test', {
				global: { fetch: fetcher },
				cookies: {
					getAll: () => [...jar].map(([name, value]) => ({ name, value })),
					setAll: (cookies) => {
						for (const { name, value } of cookies) {
							if (value) jar.set(name, value);
							else jar.delete(name);
						}
					}
				}
			});
		await client().auth.signInWithOtp({
			email: 'test@example.com',
			options: {
				emailRedirectTo: 'https://erms.epsilonrecords.com/auth/callback',
				shouldCreateUser: false
			}
		});
		expect([...jar.keys()].some((name) => name.includes('code-verifier'))).toBe(true);
		await expect(
			GET({
				url: new URL('https://erms.epsilonrecords.com/auth/callback?code=test-code'),
				locals: { supabase: client() }
			} as never)
		).rejects.toMatchObject({ status: 303, location: '/?signed-in' });
		expect(requests.map((r) => r.path)).toEqual(['/auth/v1/otp', '/auth/v1/token']);
		expect(requests[1].body.auth_code).toBe('test-code');
		expect(requests[1].body.code_verifier).toBeTruthy();
		const { data } = await client().auth.getSession();
		expect(data.session?.user.id).toBe(user.id);
		expect(data.session?.refresh_token).toBe('test-refresh-token');
	});
});
