import { z } from 'zod';
import { verifyHook } from './signature';
import { chooseSender, SENDERS, type SenderId } from './sender';
import { render, UnsupportedEmailType, type HookEmailData, type HookUser } from './templates';
import { ResendFailed, sendWithResend } from './resend';

/**
 * Supabase Auth's "Send Email" hook (EPSILON-147, decision 0027): Supabase POSTs every auth email
 * here instead of sending it over SMTP, and this picks the sender and sends it through Resend.
 *
 * Order: verify the signature on the raw body, parse, look up the account's org ids (the only
 * database read, as erms_auth_email), choose the sender, render, send. **It fails closed**: any
 * missing setting, unknown email type, failed lookup or refused send answers an error, Supabase
 * reports the sign-in as failed, and no email goes out from the other domain instead.
 */

export const AUTH_EMAIL_HOOK_PATH = '/api/auth/send-email';

export type HookConfig = {
	hookSecret: string | undefined;
	keys: Record<SenderId, string | undefined>;
	epsilonOrgId: string | undefined;
	supabaseUrl: string;
};

export type HookDeps = {
	config: HookConfig;
	/** Origin of this app, for invite links to /auth/confirm. */
	appOrigin: string;
	/** Every org id the account belongs to. */
	memberOrgIds: (userId: string) => Promise<string[]>;
	fetcher: typeof fetch;
	now?: () => number;
	log?: (line: Record<string, unknown>) => void;
};

const Payload = z.object({
	user: z.looseObject({
		id: z.uuid(),
		email: z.string().min(3),
		new_email: z.string().nullish(),
		user_metadata: z.record(z.string(), z.unknown()).nullish()
	}),
	email_data: z.looseObject({
		token: z.string().default(''),
		token_hash: z.string().default(''),
		redirect_to: z.string().default(''),
		email_action_type: z.string().min(1),
		site_url: z.string().default(''),
		token_new: z.string().default(''),
		token_hash_new: z.string().default(''),
		old_email: z.string().nullish(),
		provider: z.string().nullish(),
		factor_type: z.string().nullish()
	})
});

const Uuid = z.uuid();

/** The error shape Supabase's auth hooks expect; `message` is what the caller of Auth sees. */
export function hookError(status: number, message: string, httpCode = status): Response {
	return new Response(JSON.stringify({ error: { http_code: httpCode, message } }), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

function defaultLog(line: Record<string, unknown>) {
	const out = JSON.stringify({ event: 'auth_email_hook', ...line });
	if (line.level === 'error') console.error(out);
	else console.log(out);
}

export async function handleSendEmailHook(request: Request, deps: HookDeps): Promise<Response> {
	const log = deps.log ?? defaultLog;
	const { config } = deps;

	if (!config.hookSecret) {
		log({ level: 'error', outcome: 'not_configured', reason: 'SEND_EMAIL_HOOK_SECRET' });
		return hookError(500, 'Sign-in email is not configured (hook secret missing).');
	}

	const rawBody = await request.text();
	const nowSeconds = Math.floor((deps.now?.() ?? Date.now()) / 1000);
	const verified = verifyHook(config.hookSecret, request.headers, rawBody, nowSeconds);
	if (!verified.ok) {
		log({ level: 'error', outcome: 'rejected', reason: verified.reason });
		return verified.reason === 'bad_secret'
			? hookError(500, 'Sign-in email is not configured (hook secret is malformed).')
			: hookError(401, `Send Email hook rejected: ${verified.reason}`);
	}

	let parsed;
	try {
		parsed = Payload.safeParse(JSON.parse(rawBody));
	} catch {
		parsed = null;
	}
	if (!parsed?.success) {
		log({ level: 'error', outcome: 'bad_payload' });
		return hookError(400, 'Send Email hook payload was not understood.');
	}
	const user = parsed.data.user as HookUser;
	const email = parsed.data.email_data as HookEmailData;
	const type = email.email_action_type;
	const base = { user: user.id, action_type: type, webhook_id: verified.id };

	const epsilonOrgId = config.epsilonOrgId;
	if (!epsilonOrgId || !Uuid.safeParse(epsilonOrgId).success) {
		log({
			...base,
			level: 'error',
			outcome: 'not_configured',
			reason: 'AUTH_EMAIL_EPSILON_ORG_ID'
		});
		return hookError(500, 'Sign-in email is not configured (Epsilon org id missing).');
	}

	let memberOrgIds: string[];
	try {
		memberOrgIds = await deps.memberOrgIds(user.id);
	} catch {
		log({ ...base, level: 'error', outcome: 'lookup_failed' });
		return hookError(500, 'Could not prepare the sign-in email. Try again shortly.');
	}

	const invited = user.user_metadata?.invited_org_id;
	const senderId = chooseSender({
		actionType: type,
		invitedOrgId: typeof invited === 'string' && Uuid.safeParse(invited).success ? invited : null,
		memberOrgIds,
		epsilonOrgId
	});
	const sender = SENDERS[senderId];
	const key = config.keys[senderId];
	if (!key) {
		// No fallback to the other domain: that would send Epsilon staff LabelKit mail, or the reverse.
		log({ ...base, level: 'error', outcome: 'not_configured', sender: sender.domain });
		return hookError(500, `Sign-in email is not configured (no Resend key for ${sender.domain}).`);
	}

	let messages;
	try {
		messages = render({
			sender,
			user,
			email,
			supabaseUrl: config.supabaseUrl,
			appOrigin: deps.appOrigin
		});
	} catch (e) {
		if (!(e instanceof UnsupportedEmailType)) throw e;
		log({
			...base,
			level: 'error',
			outcome: 'unsupported',
			reason: e.message,
			sender: sender.domain
		});
		return hookError(500, `This kind of email (${type}) is not supported.`);
	}

	const ids: string[] = [];
	for (const [i, message] of messages.entries()) {
		try {
			ids.push(
				await sendWithResend(deps.fetcher, key, sender.from, message, `${verified.id}:${i}`)
			);
		} catch (e) {
			const status = e instanceof ResendFailed ? e.status : 0;
			const reason = e instanceof Error ? e.message : 'unknown';
			log({
				...base,
				level: 'error',
				outcome: 'send_failed',
				sender: sender.domain,
				status,
				reason,
				sent: i
			});
			return status === 429
				? hookError(502, 'Too many emails were sent recently. Wait a while, then try again.', 429)
				: hookError(502, 'The sign-in email could not be sent. Try again shortly.', 500);
		}
	}

	log({ ...base, level: 'info', outcome: 'sent', sender: sender.domain, resend_ids: ids });
	return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
}
