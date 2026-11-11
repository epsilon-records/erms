import type { Message } from './templates';

/**
 * One email through Resend's API (POST /emails). Each sender has its own key, limited in Resend to
 * that sender's domain, so a key can never send as the other domain.
 *
 * `idempotencyKey` is `${webhook-id}:${index}`. It only dedupes a replay of the same hook call
 * (the same `webhook-id`, e.g. a request delivered twice). It does **not** dedupe Supabase's own
 * retries: Supabase makes a new `webhook-id` for every attempt (supabase/auth
 * `internal/hooks/hookshttp/hookshttp.go`), so if a connection drops after Resend accepted the
 * email and Supabase retries, the email goes out again. That is harmless for these emails (a
 * second copy of the same link or notice).
 */

export const RESEND_URL = 'https://api.resend.com/emails';
/** Most one Resend call may take; the hook also caps it at what is left of its own budget. */
export const RESEND_TIMEOUT_MS = 3500;

export class ResendFailed extends Error {
	constructor(
		readonly status: number,
		message: string
	) {
		super(message);
	}
}

export async function sendWithResend(
	fetcher: typeof fetch,
	key: string,
	from: string,
	message: Message,
	idempotencyKey: string,
	timeoutMs: number = RESEND_TIMEOUT_MS
): Promise<string> {
	let res: Response;
	try {
		res = await fetcher(RESEND_URL, {
			method: 'POST',
			headers: {
				authorization: `Bearer ${key}`,
				'content-type': 'application/json',
				'idempotency-key': idempotencyKey
			},
			body: JSON.stringify({
				from,
				to: [message.to],
				subject: message.subject,
				html: message.html,
				text: message.text
			}),
			signal: AbortSignal.timeout(Math.max(1, Math.min(timeoutMs, RESEND_TIMEOUT_MS)))
		});
	} catch (e) {
		throw new ResendFailed(
			0,
			e instanceof Error && e.name === 'TimeoutError' ? 'timeout' : 'network'
		);
	}
	if (!res.ok) {
		// Resend's error body names the problem (`validation_error`, `rate_limit_exceeded`, ...).
		// Keep only its `name`, never the request: the body holds the sign-in link.
		let name = '';
		try {
			const body = (await res.json()) as { name?: unknown };
			if (typeof body?.name === 'string') name = body.name;
		} catch {
			/* not JSON */
		}
		throw new ResendFailed(res.status, name || `http_${res.status}`);
	}
	const body = (await res.json().catch(() => ({}))) as { id?: unknown };
	return typeof body.id === 'string' ? body.id : '';
}
