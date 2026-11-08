import { describe, expect, it, vi } from 'vitest';
import { GET } from './+server';
import { ORG_COOKIE } from '#lib/server/org.js';

describe('invitation landing', () => {
	it('verifies the token hash server-side and selects the invited label before onboarding', async () => {
		const verifyOtp = vi.fn(async () => ({ error: null })),
			exchangeCodeForSession = vi.fn(),
			set = vi.fn();
		const org = '11111111-1111-4111-8111-111111111111';
		await expect(
			GET({
				url: new URL(
					`https://erms.epsilonrecords.com/auth/callback?token_hash=test-only-hash&org=${org}`
				),
				locals: { supabase: { auth: { verifyOtp, exchangeCodeForSession } } },
				cookies: { set }
			} as never)
		).rejects.toMatchObject({ status: 303, location: '/onboarding?invited' });
		expect(verifyOtp).toHaveBeenCalledWith({ token_hash: 'test-only-hash', type: 'email' });
		expect(set).toHaveBeenCalledWith(
			ORG_COOKIE,
			org,
			expect.objectContaining({ path: '/', httpOnly: true, sameSite: 'lax', secure: true })
		);
		expect(exchangeCodeForSession).not.toHaveBeenCalled();
	});
	it('does not select an org after failed, expired or consumed verification', async () => {
		const set = vi.fn();
		await expect(
			GET({
				url: new URL(
					'https://erms.epsilonrecords.com/auth/callback?token_hash=test-only-hash&org=11111111-1111-4111-8111-111111111111'
				),
				locals: {
					supabase: { auth: { verifyOtp: async () => ({ error: { code: 'otp_expired' } }) } }
				},
				cookies: { set }
			} as never)
		).rejects.toMatchObject({ status: 303, location: '/login?link=invalid' });
		expect(set).not.toHaveBeenCalled();
	});
});
