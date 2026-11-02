import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Magic-link landing: swap the one-time code for a session cookie.
 *
 * Both redirects carry their own non-empty query string on purpose. Netlify appends
 * the incoming query to any redirect whose Location has none (an empty `?` counts
 * as none), which would otherwise leave the spent login code in the address bar.
 * The layout then drops the `signed-in` marker from the URL.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	const code = url.searchParams.get('code');
	if (code) {
		const { error } = await locals.supabase.auth.exchangeCodeForSession(code);
		if (!error) redirect(303, '/?signed-in');
	}
	redirect(303, '/login?link=invalid');
};
