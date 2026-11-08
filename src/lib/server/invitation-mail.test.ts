import { describe, expect, it, vi, afterEach } from 'vitest';
import { invitationMessage, invitationDelivery, INVITE_SENDER } from './invitation-mail';

afterEach(() => vi.unstubAllGlobals());
describe('label-specific invitations', () => {
	it('names only the selected label and escapes its HTML without modifying user metadata', () => {
		const mail = invitationMessage({
			email: 'test@example.com',
			orgId: 'org-id',
			orgName: 'Other <Label> & Friends',
			tokenHash: 'test-only-hash'
		});
		expect(mail.subject).toContain('Other <Label> & Friends');
		expect(mail.html).toContain('Other &lt;Label&gt; &amp; Friends');
		expect(mail.html).not.toContain('<Label>');
		expect(mail.from).toBe(INVITE_SENDER);
		expect(mail.text).toContain(
			'https://erms.epsilonrecords.com/auth/callback?token_hash=test-only-hash&org=org-id'
		);
		expect(mail.text).not.toContain('Epsilon Records');
	});

	it('uses Supabase to generate a link for either existing or new users, then Resend separately', async () => {
		const calls: { url: string; body: unknown }[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const request = input instanceof Request ? input : new Request(input, init);
				calls.push({ url: request.url, body: await request.json() });
				return new Response(
					JSON.stringify(
						request.url.includes('/admin/generate_link')
							? {
									id: 'user-id',
									properties: {},
									hashed_token: 'test-only-hash',
									verification_type: 'magiclink'
								}
							: { id: 'email-id' }
					),
					{ headers: { 'Content-Type': 'application/json' } }
				);
			})
		);
		const delivery = invitationDelivery({
			url: 'https://example.supabase.co',
			secretKey: 'test-key',
			resendKey: 'test-resend-key'
		});
		const link = await delivery.generate('test@example.com');
		expect(link).toEqual({ userId: 'user-id', tokenHash: 'test-only-hash' });
		expect(calls).toHaveLength(1);
		expect(calls[0].body).toMatchObject({ type: 'magiclink', email: 'test@example.com' });
		await delivery.send({
			email: 'test@example.com',
			orgId: 'org-id',
			orgName: 'Chosen Label',
			tokenHash: link.tokenHash
		});
		expect(calls[1].url).toBe('https://api.resend.com/emails');
		expect(calls[1].body).toMatchObject({
			from: INVITE_SENDER,
			subject: 'Invitation to Chosen Label on ERMS'
		});
	});
});
