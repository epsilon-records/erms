import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	if (locals.user) redirect(303, '/');
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
		if (error) {
			return fail(400, { error: 'Could not send a login link. Check the address and try again.' });
		}
		return { sent: parsed.data };
	}
};
