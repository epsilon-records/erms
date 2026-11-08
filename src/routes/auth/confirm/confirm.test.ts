import { describe, expect, it, vi } from 'vitest';
import { GET } from './+server';

function event(search: string, verifyOtp = vi.fn()) {
	return {
		url: new URL(`/auth/confirm${search}`, 'https://erms.epsilonrecords.com'),
		locals: { supabase: { auth: { verifyOtp } } }
	} as never;
}

describe('invite landing', () => {
	it('verifies an invite token hash and drops it from the redirect', async () => {
		const verify = vi.fn().mockResolvedValue({ error: null });
		await expect(GET(event('?token_hash=abc&type=invite', verify))).rejects.toMatchObject({
			status: 303,
			location: '/?signed-in'
		});
		expect(verify).toHaveBeenCalledWith({ token_hash: 'abc', type: 'invite' });
	});

	it('sends a spent or forged token to the login page', async () => {
		const verify = vi.fn().mockResolvedValue({ error: { code: 'otp_expired' } });
		await expect(GET(event('?token_hash=spent&type=invite', verify))).rejects.toMatchObject({
			status: 303,
			location: '/login?link=invalid'
		});
	});

	it('refuses link types it does not serve, without calling Auth', async () => {
		const verify = vi.fn();
		for (const search of ['?token_hash=abc&type=recovery', '?token_hash=abc', '?type=invite']) {
			await expect(GET(event(search, verify))).rejects.toMatchObject({
				location: '/login?link=invalid'
			});
		}
		expect(verify).not.toHaveBeenCalled();
	});
});
