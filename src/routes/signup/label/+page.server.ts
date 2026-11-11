import { fail, redirect } from '@sveltejs/kit';
import { SIGNUP_ENABLED } from '$app/env/private';
import { ORG_COOKIE } from '#lib/server/org.js';
import { createLabel, labelForm } from '#lib/server/signup.js';
import type { Actions, PageServerLoad } from './$types';

/** Self-serve signup, step 2 (EPSILON-130): a signed-in user with no label names one. */
export const load: PageServerLoad = ({ locals }) => {
	if (!locals.user) redirect(303, '/signup');
	if (locals.membership) redirect(303, '/');
	return { open: SIGNUP_ENABLED, email: locals.user.email ?? null };
};

const MESSAGES = {
	slug_taken: { field: 'slug', error: 'That address is taken. Pick another.' },
	limit: { field: 'name', error: 'This account already owns the maximum number of labels.' },
	invalid: { field: 'name', error: 'Check the name and the address.' }
} as const;

export const actions: Actions = {
	default: async ({ request, locals, cookies }) => {
		if (!locals.user) redirect(303, '/signup');
		if (!SIGNUP_ENABLED) return fail(403, { error: 'Signup is closed.' });

		const data = await request.formData();
		const values = { name: String(data.get('name') ?? ''), slug: String(data.get('slug') ?? '') };
		const parsed = labelForm.safeParse(values);
		if (!parsed.success) {
			return fail(400, { values, error: parsed.error.issues[0]?.message ?? 'Check the form.' });
		}

		const result = await locals.db((tx) => createLabel(tx, parsed.data));
		if (!result.ok) return fail(400, { values, error: MESSAGES[result.reason].error });

		cookies.set(ORG_COOKIE, result.orgId, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			maxAge: 60 * 60 * 24 * 365
		});
		redirect(303, '/onboarding');
	}
};
