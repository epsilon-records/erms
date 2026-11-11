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
			return fail(400, { error: 'Could not send a login link. Check the address and try again.' });
		}
		return { sent: parsed.data };
	}
};
