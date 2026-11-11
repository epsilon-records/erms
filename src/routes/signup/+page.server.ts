import { fail, redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { SIGNUP_ENABLED } from '$app/env/private';
import type { Actions, PageServerLoad } from './$types';

/** Self-serve signup, step 1 (EPSILON-130): email → magic link. Step 2 is /signup/label. */
export const load: PageServerLoad = ({ locals }) => {
	if (locals.user) redirect(303, locals.membership ? '/' : '/signup/label');
	return { open: SIGNUP_ENABLED };
};

export const actions: Actions = {
	default: async ({ request, locals, url }) => {
		if (!SIGNUP_ENABLED)
			return fail(403, { error: 'Signup is closed. Ask a label owner for an invite.' });
		const parsed = z.email().safeParse((await request.formData()).get('email'));
		if (!parsed.success) return fail(400, { error: 'Enter a valid email address.' });

		const { error } = await locals.supabase.auth.signInWithOtp({
			email: parsed.data,
			options: { emailRedirectTo: `${url.origin}/auth/callback`, shouldCreateUser: true }
		});
		if (error?.status === 429) {
			return fail(429, {
				error: 'Too many emails were sent recently. Wait a while, then try again.'
			});
		}
		if (error)
			return fail(400, {
				error: 'Could not send a sign-up link. Check the address and try again.'
			});
		return { sent: parsed.data };
	}
};
