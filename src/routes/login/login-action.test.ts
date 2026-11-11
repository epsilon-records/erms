import { describe, expect, it, vi } from 'vitest';

const { actions } = await import('./+page.server.js');

type OtpResult = { error: { status?: number; message: string } | null };

/** Runs the login action for `email` against a Supabase stub that answers `result`. */
async function submit(email: string, result: OtpResult) {
	const signInWithOtp = vi.fn(async () => result);
	const body = new FormData();
	body.set('email', email);
	const outcome = await actions.default({
		request: new Request('https://labelkit.test/login', { method: 'POST', body }),
		locals: { supabase: { auth: { signInWithOtp } } },
		url: new URL('https://labelkit.test/login')
	} as never);
	return { outcome, signInWithOtp };
}

describe('login action', () => {
	it('answers the same for an address with and without an account', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const known = await submit('known@example.test', { error: null });
		// What Supabase answers for an unknown address when shouldCreateUser is false.
		const unknown = await submit('unknown@example.test', {
			error: { status: 422, message: 'Signups not allowed for otp' }
		});
		const failing = await submit('other@example.test', {
			error: { status: 500, message: 'Error sending magic link email' }
		});

		expect(known.outcome).toEqual({ sent: 'known@example.test' });
		expect(unknown.outcome).toEqual({ sent: 'unknown@example.test' });
		expect(failing.outcome).toEqual({ sent: 'other@example.test' });
		// The failure is logged without the address.
		expect(JSON.stringify(warn.mock.calls)).not.toContain('example.test');
		warn.mockRestore();
	});

	it('never creates an account from the login page', async () => {
		const { signInWithOtp } = await submit('known@example.test', { error: null });
		expect(signInWithOtp).toHaveBeenCalledWith(
			expect.objectContaining({ options: expect.objectContaining({ shouldCreateUser: false }) })
		);
	});

	it('still reports the rate limit', async () => {
		const { outcome } = await submit('known@example.test', {
			error: { status: 429, message: 'Email rate limit exceeded' }
		});
		expect(outcome).toMatchObject({ status: 429 });
	});

	it('still rejects a malformed address', async () => {
		const { outcome, signInWithOtp } = await submit('not-an-address', { error: null });
		expect(outcome).toMatchObject({ status: 400 });
		expect(signInWithOtp).not.toHaveBeenCalled();
	});
});
