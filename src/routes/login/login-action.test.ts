import { AuthApiError, AuthRetryableFetchError, type AuthError } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { actions } = await import('./+page.server.js');

/** Runs the login action for `email` against a Supabase stub that answers `error`. */
async function submit(email: string, error: AuthError | null = null) {
	const signInWithOtp = vi.fn(async () => ({ data: {}, error }));
	const body = new FormData();
	body.set('email', email);
	const outcome = await actions.default({
		request: new Request('https://labelkit.test/login', { method: 'POST', body }),
		locals: { supabase: { auth: { signInWithOtp } } },
		url: new URL('https://labelkit.test/login')
	} as never);
	return { outcome, signInWithOtp };
}

const api = (status: number, code: string) => new AuthApiError('refused', status, code);

describe('login action', () => {
	let warn: ReturnType<typeof vi.spyOn>;
	beforeEach(() => {
		warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	});
	afterEach(() => warn.mockRestore());

	it('answers a known address with "sent"', async () => {
		expect((await submit('known@example.test')).outcome).toEqual({ sent: 'known@example.test' });
	});

	// Each of these depends on whether the address has an account, so each must look like a sent link.
	it.each([
		['an unknown address (422 otp_disabled)', api(422, 'otp_disabled')],
		[
			'a repeat request for a known address (429 over_email_send_rate_limit)',
			api(429, 'over_email_send_rate_limit')
		],
		['a failing Send Email hook (500)', api(500, 'hook_timeout')],
		['an upstream 503 from Supabase', new AuthRetryableFetchError('Service unavailable', 503)]
	])('answers %s exactly like a sent link', async (_case, error) => {
		const { outcome } = await submit('someone@example.test', error);
		expect(outcome).toEqual({ sent: 'someone@example.test' });
	});

	it('logs a hidden failure by status and code, never the address', async () => {
		await submit('someone@example.test', api(422, 'otp_disabled'));
		expect(warn).toHaveBeenCalledTimes(1);
		const logged = JSON.parse(String(warn.mock.calls[0][0]));
		expect(logged).toMatchObject({ status: 422, code: 'otp_disabled' });
		expect(JSON.stringify(warn.mock.calls)).not.toContain('example.test');
	});

	it('reports the per-IP request limit, which is the same for every address', async () => {
		const { outcome } = await submit('someone@example.test', api(429, 'over_request_rate_limit'));
		expect(outcome).toMatchObject({ status: 429 });
	});

	it('reports Supabase being unreachable', async () => {
		for (const status of [0, undefined]) {
			const error = new AuthRetryableFetchError('Failed to fetch', status as never);
			const { outcome } = await submit('someone@example.test', error);
			expect(outcome, String(status)).toMatchObject({ status: 503 });
		}
	});

	it('never creates an account from the login page', async () => {
		const { signInWithOtp } = await submit('known@example.test');
		expect(signInWithOtp).toHaveBeenCalledWith(
			expect.objectContaining({ options: expect.objectContaining({ shouldCreateUser: false }) })
		);
	});

	it('still rejects a malformed address', async () => {
		const { outcome, signInWithOtp } = await submit('not-an-address');
		expect(outcome).toMatchObject({ status: 400 });
		expect(signInWithOtp).not.toHaveBeenCalled();
	});
});
