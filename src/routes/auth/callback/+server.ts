import { redirect } from '@sveltejs/kit';
import { ORG_COOKIE } from '#lib/server/org.js';
import type { RequestHandler } from './$types';

/**
 * Magic-link landing: swap the one-time code for a session cookie.
 *
 * Both redirects carry their own non-empty query string on purpose. Netlify appends
 * the incoming query to any redirect whose Location has none (an empty `?` counts
 * as none), which would otherwise leave the spent login code in the address bar.
 * The layout then drops the `signed-in` marker from the URL.
 */
export const GET: RequestHandler = async ({ url, locals, cookies }) => {
	// Owner invitations use a server-verified Supabase token hash, not the owner's PKCE cookie.
	// The next request validates this org cookie against the signed-in user's memberships.
	const tokenHash = url.searchParams.get('token_hash');
	if (tokenHash) {
		const { error } = await locals.supabase.auth.verifyOtp({
			token_hash: tokenHash,
			type: 'email'
		});
		if (!error) {
			const org = url.searchParams.get('org');
			if (org && /^[0-9a-f-]{36}$/i.test(org))
				cookies.set(ORG_COOKIE, org, {
					path: '/',
					httpOnly: true,
					sameSite: 'lax',
					secure: url.protocol === 'https:',
					maxAge: 60 * 60 * 24 * 365
				});
			redirect(303, '/onboarding?invited');
		}
		redirect(303, '/login?link=invalid');
	}
	const code = url.searchParams.get('code');
	if (code) {
		const { error } = await locals.supabase.auth.exchangeCodeForSession(code);
		if (!error) redirect(303, '/?signed-in');
	}
	redirect(303, '/login?link=invalid');
};
