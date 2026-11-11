import { fail, redirect } from '@sveltejs/kit';
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
		if (error?.status === 429) {
			// Supabase's built-in mailer allows only a few emails per hour per project.
			return fail(429, {
				error: 'Too many login emails were sent recently. Wait a while, then try again.'
			});
		}
		if (error) {
			// Answer exactly as for a known address: with shouldCreateUser off, Supabase errors for an
			// address with no account, so reporting the failure would say which addresses have one.
			// Log the status only, never the address.
			console.warn(
				JSON.stringify({ level: 'warn', msg: 'login link not sent', status: error.status ?? null })
			);
		}
		return { sent: parsed.data };
	}
};
