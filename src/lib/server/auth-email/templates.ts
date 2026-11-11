import type { Sender } from './sender';

/**
 * The auth emails, rendered by the Send Email hook (EPSILON-147). With the hook on, Supabase's own
 * templates are no longer used, so every email type Supabase can send is covered here.
 *
 * - **Invite** ports `supabase/templates/invite.html`: it names the label the person is invited to
 *   from `invited_org_name` (decision 0021's rule, kept by 0027) and links to `/auth/confirm` with
 *   the token hash, because an invite is opened in another browser than the one that sent it.
 * - **Everything else** has no copy in the repo: the hosted magic-link template is Supabase's
 *   `{{ .ConfirmationURL }}` default (docs/magic-link-redirects.md). It gets plain, neutral copy
 *   that names no label, and its link is the same Auth `/verify` URL that `.ConfirmationURL` was,
 *   so the PKCE sign-in flow through `/auth/callback` is unchanged.
 *
 * An email type this file does not know is refused, never sent with guessed copy.
 */

export type HookUser = {
	id: string;
	email: string;
	new_email?: string | null;
	user_metadata?: Record<string, unknown> | null;
};

export type HookEmailData = {
	token: string;
	token_hash: string;
	redirect_to: string;
	email_action_type: string;
	site_url: string;
	token_new: string;
	token_hash_new: string;
	old_email?: string | null;
	provider?: string | null;
	factor_type?: string | null;
};

export type RenderContext = {
	sender: Sender;
	user: HookUser;
	email: HookEmailData;
	/** Supabase project URL, e.g. https://<ref>.supabase.co. Verify links go to its /auth/v1. */
	supabaseUrl: string;
	/** Supabase Auth's Site URL (`{{ .SiteURL }}`), where invites open `/auth/confirm`. */
	siteUrl: string;
};

export type Message = { to: string; subject: string; html: string; text: string };

export class UnsupportedEmailType extends Error {}

export function escapeHtml(s: string): string {
	return s
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

/** The URL Supabase's `{{ .ConfirmationURL }}` stands for. */
export function verifyUrl(
	supabaseUrl: string,
	tokenHash: string,
	type: string,
	redirectTo: string
) {
	const url = new URL('/auth/v1/verify', supabaseUrl);
	url.searchParams.set('token', tokenHash);
	url.searchParams.set('type', type);
	if (redirectTo) url.searchParams.set('redirect_to', redirectTo);
	return url.toString();
}

export function inviteUrl(siteUrl: string, tokenHash: string) {
	const url = new URL('/auth/confirm', siteUrl);
	url.searchParams.set('token_hash', tokenHash);
	url.searchParams.set('type', 'invite');
	return url.toString();
}

type Body = { heading: string; paragraphs: string[]; link?: { href: string; label: string } };

function compose(to: string, subject: string, body: Body, footer: string): Message {
	const html = [
		`<h2>${escapeHtml(body.heading)}</h2>`,
		...body.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`),
		...(body.link
			? [`<p><a href="${escapeHtml(body.link.href)}">${escapeHtml(body.link.label)}</a></p>`]
			: []),
		`<p>${escapeHtml(footer)}</p>`
	].join('\n');
	const text = [
		body.heading,
		'',
		...body.paragraphs.flatMap((p) => [p, '']),
		...(body.link ? [`${body.link.label}: ${body.link.href}`, ''] : []),
		footer
	]
		.join('\n')
		.trimEnd();
	return { to, subject, html, text };
}

const IGNORE = "If you weren't expecting this, you can ignore this email.";
const NOT_YOU = "If this wasn't you, tell your label's owner.";

function invitedOrgName(user: HookUser): string | null {
	const name = user.user_metadata?.invited_org_name;
	return typeof name === 'string' && name.trim() ? name.trim() : null;
}

const NOTICES: Record<string, (ctx: RenderContext) => { subject: string; line: string }> = {
	password_changed_notification: () => ({
		subject: 'Your password was changed',
		line: 'The password for your account was changed.'
	}),
	email_changed_notification: (ctx) => ({
		subject: 'Your email address was changed',
		line: ctx.email.old_email
			? `The email address for your account was changed from ${ctx.email.old_email} to ${ctx.user.email}.`
			: `The email address for your account was changed to ${ctx.user.email}.`
	}),
	phone_changed_notification: () => ({
		subject: 'Your phone number was changed',
		line: 'The phone number for your account was changed.'
	}),
	identity_linked_notification: (ctx) => ({
		subject: 'A sign-in method was linked to your account',
		line: `A new sign-in method${ctx.email.provider ? ` (${ctx.email.provider})` : ''} was linked to your account.`
	}),
	identity_unlinked_notification: (ctx) => ({
		subject: 'A sign-in method was removed from your account',
		line: `A sign-in method${ctx.email.provider ? ` (${ctx.email.provider})` : ''} was removed from your account.`
	}),
	mfa_factor_enrolled_notification: (ctx) => ({
		subject: 'A verification method was added to your account',
		line: `A multi-factor verification method${ctx.email.factor_type ? ` (${ctx.email.factor_type})` : ''} was added to your account.`
	}),
	mfa_factor_unenrolled_notification: (ctx) => ({
		subject: 'A verification method was removed from your account',
		line: `A multi-factor verification method${ctx.email.factor_type ? ` (${ctx.email.factor_type})` : ''} was removed from your account.`
	})
};

/** One email, or two for a secure email change (one to the current address, one to the new). */
export function render(ctx: RenderContext): Message[] {
	const { sender, user, email } = ctx;
	const product = sender.product;
	const type = email.email_action_type;
	const link = (hash: string, label: string, t = type) => ({
		href: verifyUrl(ctx.supabaseUrl, hash, t, email.redirect_to),
		label
	});

	switch (type) {
		case 'invite': {
			const org = invitedOrgName(user);
			return [
				compose(
					user.email,
					`You're invited to ${org ?? 'a label'} on ${product}`,
					{
						heading: `You're invited to ${org ?? 'a label'} on ${product}`,
						paragraphs: [
							`${org ?? 'A label'} uses ${product} for its catalogue, rights and releases, and has invited you to join.`
						],
						link: {
							href: inviteUrl(ctx.siteUrl, email.token_hash),
							label: 'Accept the invite and sign in'
						}
					},
					`The link works once. ${IGNORE}`
				)
			];
		}
		case 'magiclink':
			return [
				compose(
					user.email,
					`Your ${product} sign-in link`,
					{
						heading: `Sign in to ${product}`,
						paragraphs: ['Use this link to sign in. It works once and expires in an hour.'],
						link: link(email.token_hash, 'Sign in')
					},
					IGNORE
				)
			];
		case 'signup':
			return [
				compose(
					user.email,
					`Confirm your email for ${product}`,
					{
						heading: `Welcome to ${product}`,
						paragraphs: ['Confirm your email address to finish creating your account and sign in.'],
						link: link(email.token_hash, 'Confirm and sign in')
					},
					IGNORE
				)
			];
		case 'recovery':
			return [
				compose(
					user.email,
					`Reset access to ${product}`,
					{
						heading: `Reset access to ${product}`,
						paragraphs: ['Use this link to get back into your account. It works once.'],
						link: link(email.token_hash, 'Reset and sign in')
					},
					IGNORE
				)
			];
		case 'email':
		case 'reauthentication':
			return [
				compose(
					user.email,
					`Your ${product} verification code`,
					{
						heading: `Your ${product} verification code`,
						paragraphs: [`Enter this code to continue: ${email.token}`]
					},
					IGNORE
				)
			];
		case 'email_change': {
			// Supabase's field names are crossed on purpose (Send Email hook docs): the current
			// address gets `token` with `token_hash_new`, the new address `token_new` with `token_hash`.
			const newEmail = user.new_email ?? null;
			if (!newEmail) throw new UnsupportedEmailType('email_change without a new address');
			const toNew = (hash: string) =>
				compose(
					newEmail,
					`Confirm your new email for ${product}`,
					{
						heading: 'Confirm your new email address',
						paragraphs: [
							`Confirm that ${newEmail} is the new address for your ${product} account.`
						],
						link: link(hash, 'Confirm the new address')
					},
					IGNORE
				);
			if (email.token_hash && email.token_hash_new) {
				return [
					compose(
						user.email,
						`Confirm the email change for ${product}`,
						{
							heading: 'Confirm your email change',
							paragraphs: [
								`Someone asked to change the address of your ${product} account from ${user.email} to ${newEmail}. Confirm it from this address too.`
							],
							link: link(email.token_hash_new, 'Confirm the change')
						},
						NOT_YOU
					),
					toNew(email.token_hash)
				];
			}
			const only = email.token_hash || email.token_hash_new;
			if (!only) throw new UnsupportedEmailType('email_change without a token hash');
			return [toNew(only)];
		}
		default: {
			const notice = NOTICES[type];
			if (!notice) throw new UnsupportedEmailType(`unsupported email type: ${type}`);
			const { subject, line } = notice(ctx);
			// Supabase's own mailer sends this notice to the address that was replaced, so its owner
			// hears about the change (supabase/auth `templatemailer.go`, `EmailChangedNotificationMail`);
			// by now `user.email` is already the new address. The hook payload carries the old one as
			// `email_data.old_email` (`mail.go`). Without it, refuse rather than tell the new address.
			let to = user.email;
			if (type === 'email_changed_notification') {
				const old = ctx.email.old_email?.trim();
				if (!old) throw new UnsupportedEmailType('email_changed_notification without old_email');
				to = old;
			}
			return [
				compose(
					to,
					`${subject} (${product})`,
					{
						heading: subject,
						paragraphs: [line]
					},
					NOT_YOU
				)
			];
		}
	}
}
