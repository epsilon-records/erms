import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** Magic-link landing: swap the one-time code for a session cookie. */
export const GET: RequestHandler = async ({ url, locals }) => {
	const code = url.searchParams.get('code');
	if (code) {
		const { error } = await locals.supabase.auth.exchangeCodeForSession(code);
		if (!error) redirect(303, '/');
	}
	redirect(303, '/login');
};
