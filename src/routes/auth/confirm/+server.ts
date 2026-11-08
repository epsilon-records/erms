import { redirect } from '@sveltejs/kit';
import type { EmailOtpType } from '@supabase/supabase-js';
import type { RequestHandler } from './$types';

/**
 * Invite landing (EPSILON-87): verify the email's one-time token hash and start a session.
 *
 * /auth/callback cannot serve invites. It exchanges a PKCE code, and PKCE ties the link to the
 * browser that asked for it, while an invite is asked for by the owner and opened by someone
 * else. So the invite template links here with `{{ .TokenHash }}` instead
 * (supabase/templates/invite.html), which works in any browser. Sign-in links are unchanged.
 *
 * As in the callback, both redirects carry their own query so Netlify does not copy the spent
 * token onto them, and hooks.server.ts sends a member who has not onboarded on to /onboarding.
 */
const TYPES: readonly EmailOtpType[] = ['invite', 'magiclink', 'email'];

export const GET: RequestHandler = async ({ url, locals }) => {
	const tokenHash = url.searchParams.get('token_hash');
	const type = url.searchParams.get('type') as EmailOtpType | null;
	if (tokenHash && type && TYPES.includes(type)) {
		const { error } = await locals.supabase.auth.verifyOtp({ token_hash: tokenHash, type });
		if (!error) redirect(303, '/?signed-in');
	}
	redirect(303, '/login?link=invalid');
};
