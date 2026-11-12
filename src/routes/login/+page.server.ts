import { fail, redirect } from '@sveltejs/kit';
import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import { z } from 'zod';
import { SIGNUP_ENABLED } from '$app/env/private';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.user) redirect(303, '/');
	return { signupOpen: SIGNUP_ENABLED };
};

export const actions: Actions = {
	default: async ({ request, locals, url }) => {
		const form = await request.formData();
		const parsed = z.email().safeParse(form.get('email'));
		if (!parsed.success) {
			return fail(400, { error: 'Enter a valid email address.' });
		}

		const { error } = await locals.supabase.auth.signInWithOtp({
			email: parsed.data,
			options: {
				emailRedirectTo: `${url.origin}/auth/callback`,
				// Accounts are created by owners, not by self sign-up.
				shouldCreateUser: false
			}
		});
		// Only failures that do not depend on the address are shown. Supabase refuses an unknown
		// address with 422 otp_disabled, while the per-address email limit (429
		// over_email_send_rate_limit) and a failing Send Email hook (500) happen only for an address
		// that has an account, so all of those answer exactly like a sent link.
		if (error?.status === 429 && error.code === 'over_request_rate_limit') {
			// The per-IP request limit: the same answer for every address.
			return fail(429, {
				error: 'Too many login attempts right now. Wait a few minutes, then try again.'
			});
		}
		if (error && isAuthRetryableFetchError(error) && !error.status) {
			// Supabase could not be reached at all, which again does not depend on the address.
			return fail(503, { error: 'Sign-in is unavailable right now. Try again shortly.' });
		}
		if (error) {
			// Status and code only, never the address.
			console.warn(
				JSON.stringify({
					level: 'warn',
					msg: 'login link not sent',
					status: error.status ?? null,
					code: error.code ?? null
				})
			);
		}
		return { sent: parsed.data };
	}
};
