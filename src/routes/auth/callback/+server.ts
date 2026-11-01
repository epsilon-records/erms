import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Magic-link landing: swap the one-time code for a session cookie.
 *
 * Both redirects carry their own query string on purpose. Netlify appends the
 * incoming query to any redirect whose Location has none, which would otherwise
 * leave the (spent) login code in the address bar and browser history.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const code = url.searchParams.get('code');
	if (code) {
		const { error } = await locals.supabase.auth.exchangeCodeForSession(code);
		if (!error) redirect(303, '/?');
	}
	redirect(303, '/login?link=invalid');
};
