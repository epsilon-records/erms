import { describe, expect, it } from 'vitest';
import { SENDERS } from './sender';
import { render, UnsupportedEmailType, type HookEmailData, type RenderContext } from './templates';

const SUPABASE = 'https://efalpthvvmvpaikuxymd.supabase.co';
const SITE = 'https://labelkit.co';

function ctx(
	type: string,
	over: Partial<RenderContext> = {},
	data: Partial<HookEmailData> = {}
): RenderContext {
	return {
		sender: SENDERS.labelkit,
		user: { id: 'u1', email: 'person@example.test', user_metadata: {} },
		email: {
			token: '123456',
			token_hash: 'pkce_hash-one',
			redirect_to: 'https://erms.epsilonrecords.com/auth/callback',
			email_action_type: type,
			site_url: `${SUPABASE}/auth/v1`,
			token_new: '',
			token_hash_new: '',
			...data
		},
		supabaseUrl: SUPABASE,
		siteUrl: SITE,
		...over
	};
}

// Every email_action_type in Supabase's Send Email hook schema (checked 2026-11-11).
const ALL_TYPES = [
	'signup',
	'invite',
	'magiclink',
	'recovery',
	'email_change',
	'email',
	'reauthentication',
	'password_changed_notification',
	'email_changed_notification',
	'phone_changed_notification',
	'identity_linked_notification',
	'identity_unlinked_notification',
	'mfa_factor_enrolled_notification',
	'mfa_factor_unenrolled_notification'
];

describe('auth email copy', () => {
	it('covers every email type Supabase can send', () => {
		for (const type of ALL_TYPES) {
			const c = ctx(type);
			if (type === 'email_change') c.user.new_email = 'new@example.test';
			if (type === 'email_changed_notification') c.email.old_email = 'old@example.test';
			const out = render(c);
			expect(out.length, type).toBeGreaterThan(0);
			for (const m of out) {
				expect(m.subject, type).not.toBe('');
				expect(m.html, type).toContain('<h2>');
				expect(m.text, type).not.toBe('');
			}
		}
	});

	it('refuses an email type it does not know instead of guessing', () => {
		expect(() => render(ctx('something_new'))).toThrow(UnsupportedEmailType);
	});

	it('invite: names the inviting label, links to /auth/confirm with the token hash', () => {
		const c = ctx('invite');
		c.user.user_metadata = { invited_org_name: 'Label A' };
		const [m] = render(c);
		expect(m.to).toBe('person@example.test');
		expect(m.subject).toBe("You're invited to Label A on LabelKit");
		expect(m.html).toContain('Label A uses LabelKit for its catalogue, rights and releases');
		expect(m.html).toContain(
			'href="https://labelkit.co/auth/confirm?token_hash=pkce_hash-one&amp;type=invite"'
		);
		expect(m.text).toContain(
			'https://labelkit.co/auth/confirm?token_hash=pkce_hash-one&type=invite'
		);
		expect(m.html).not.toContain('/auth/v1/verify');
		expect(`${m.subject}${m.html}`).not.toMatch(/epsilon/i);
	});

	it('invite: links to Supabase’s Site URL, not the payload’s site_url (the Auth API URL)', () => {
		const c = ctx('invite', { siteUrl: 'https://site.example.test/' });
		const [m] = render(c);
		expect(m.text).toContain(
			'https://site.example.test/auth/confirm?token_hash=pkce_hash-one&type=invite'
		);
		expect(m.html).not.toContain(c.email.site_url);
	});

	it('invite to Epsilon from Epsilon’s sender calls the app ERMS', () => {
		const c = ctx('invite', { sender: SENDERS.epsilon });
		c.user.user_metadata = { invited_org_name: 'Epsilon Records' };
		expect(render(c)[0].subject).toBe("You're invited to Epsilon Records on ERMS");
	});

	it('invite without an org name says "a label", as the old template did', () => {
		const [m] = render(ctx('invite'));
		expect(m.subject).toBe("You're invited to a label on LabelKit");
		expect(m.html).toContain('A label uses LabelKit');
	});

	it('escapes the org name, which owners choose', () => {
		const c = ctx('invite');
		c.user.user_metadata = { invited_org_name: '<script>x</script> & "Co"' };
		const [m] = render(c);
		expect(m.html).not.toContain('<script>');
		expect(m.html).toContain('&lt;script&gt;x&lt;/script&gt; &amp; &quot;Co&quot;');
	});

	it('magic link: the same Auth verify URL as {{ .ConfirmationURL }}, so PKCE sign-in is unchanged', () => {
		const [m] = render(ctx('magiclink'));
		const href = /href="([^"]+)"/.exec(m.html)![1].replaceAll('&amp;', '&');
		const url = new URL(href);
		expect(url.origin + url.pathname).toBe(`${SUPABASE}/auth/v1/verify`);
		expect(url.searchParams.get('token')).toBe('pkce_hash-one');
		expect(url.searchParams.get('type')).toBe('magiclink');
		expect(url.searchParams.get('redirect_to')).toBe(
			'https://erms.epsilonrecords.com/auth/callback'
		);
		expect(`${m.subject}${m.html}`).not.toMatch(/epsilon records|label a/i);
	});

	it('secure email change: two emails, with Supabase’s crossed token fields', () => {
		const c = ctx(
			'email_change',
			{},
			{ token_hash: 'hash-for-new', token_hash_new: 'hash-for-current' }
		);
		c.user.new_email = 'new@example.test';
		const [current, next] = render(c);
		expect(current.to).toBe('person@example.test');
		expect(current.html).toContain('token=hash-for-current');
		expect(next.to).toBe('new@example.test');
		expect(next.html).toContain('token=hash-for-new');
	});

	it('single email change: one email, to the new address', () => {
		const c = ctx('email_change', {}, { token_hash: '', token_hash_new: 'only-hash' });
		c.user.new_email = 'new@example.test';
		const out = render(c);
		expect(out).toHaveLength(1);
		expect(out[0].to).toBe('new@example.test');
		expect(out[0].html).toContain('token=only-hash');
	});

	it('email changed notice goes to the old address, as Supabase’s own mailer sends it', () => {
		const c = ctx('email_changed_notification', {}, { old_email: 'old@example.test' });
		c.user.email = 'new@example.test';
		const out = render(c);
		expect(out).toHaveLength(1);
		expect(out[0].to).toBe('old@example.test');
		expect(out[0].text).toContain('changed from old@example.test to new@example.test');
	});

	it('email changed notice without old_email is refused, never sent to the new address', () => {
		for (const old of [undefined, null, '', '  ']) {
			const c = ctx('email_changed_notification', {}, { old_email: old });
			c.user.email = 'new@example.test';
			expect(() => render(c), String(old)).toThrow(UnsupportedEmailType);
		}
	});

	it('other notices go to the account’s current address', () => {
		const c = ctx('password_changed_notification', {}, { old_email: 'old@example.test' });
		expect(render(c)[0].to).toBe('person@example.test');
	});

	it('reauthentication sends the code, not a link', () => {
		const [m] = render(ctx('reauthentication'));
		expect(m.text).toContain('123456');
		expect(m.html).not.toContain('href=');
	});
});
