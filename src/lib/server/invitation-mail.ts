import { createClient } from '@supabase/supabase-js';

export const INVITE_ORIGIN = 'https://erms.epsilonrecords.com';
export const INVITE_SENDER = 'ERMS <no-reply@auth.epsilonrecords.com>';
const escapeHtml = (value: string) =>
	value.replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
	);

/** No per-user metadata: the chosen org belongs to this email, including for multi-label users. */
export function invitationMessage(input: {
	email: string;
	orgId: string;
	orgName: string;
	tokenHash: string;
}) {
	const url = new URL('/auth/callback', INVITE_ORIGIN);
	url.searchParams.set('token_hash', input.tokenHash);
	url.searchParams.set('org', input.orgId);
	return {
		from: INVITE_SENDER,
		to: [input.email],
		subject: `Invitation to ${input.orgName.replace(/[\r\n]/g, ' ')} on ERMS`,
		text: `You have been invited to ${input.orgName} on ERMS. Sign in and get started: ${url.href}\nThis sign-in link can be used once.`,
		html: `<p>You have been invited to <strong>${escapeHtml(input.orgName)}</strong> on ERMS.</p><p><a href="${escapeHtml(url.href)}">Sign in and get started</a></p><p>This sign-in link can be used once.</p>`
	};
}

export function invitationDelivery(config: { url: string; secretKey: string; resendKey: string }) {
	const client = createClient(config.url, config.secretKey, {
		auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
	});
	return {
		generate: async (email: string) => {
			// generateLink supports both new and existing accounts and sends no mail itself.
			const { data, error } = await client.auth.admin.generateLink({ type: 'magiclink', email });
			if (error || !data.user || !data.properties?.hashed_token)
				throw new Error('Could not prepare the invitation. No invitation email was sent.');
			return { userId: data.user.id, tokenHash: data.properties.hashed_token };
		},
		send: async (input: Parameters<typeof invitationMessage>[0]) => {
			const response = await fetch('https://api.resend.com/emails', {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${config.resendKey}`,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify(invitationMessage(input)),
				signal: AbortSignal.timeout(15000)
			});
			if (!response.ok) throw new Error('Invitation delivery was not confirmed.');
		}
	};
}
