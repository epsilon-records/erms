import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Supabase signs HTTP auth hooks with the Standard Webhooks scheme
 * (https://www.standardwebhooks.com/):
 *
 * - headers `webhook-id`, `webhook-timestamp` (unix seconds) and `webhook-signature`, a
 *   space-separated list of `v1,<base64 HMAC-SHA256>`;
 * - the signed content is `${id}.${timestamp}.${rawBody}`;
 * - the key is the base64 after `whsec_`. Supabase shows the secret as `v1,whsec_<base64>`, so
 *   either form is accepted here.
 *
 * Only `v1` signatures count, the timestamp must be within five minutes, and the comparison is
 * constant-time.
 */

export const DEFAULT_TOLERANCE_SECONDS = 300;

export type HookVerifyResult =
	| { ok: true; id: string; timestamp: number }
	| { ok: false; reason: 'bad_secret' | 'missing' | 'malformed' | 'stale' | 'bad_signature' };

/** The HMAC key from a secret written as `v1,whsec_<base64>` or `whsec_<base64>`; null if neither. */
export function hookKey(secret: string): Buffer | null {
	const m = /^(?:v1,)?whsec_([A-Za-z0-9+/]+={0,2})$/.exec(secret.trim());
	if (!m) return null;
	const key = Buffer.from(m[1], 'base64');
	return key.length >= 16 ? key : null;
}

export function signHook(key: Buffer, id: string, timestamp: number, rawBody: string): string {
	return createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest('base64');
}

export function verifyHook(
	secret: string,
	headers: Headers,
	rawBody: string,
	nowSeconds: number = Math.floor(Date.now() / 1000),
	toleranceSeconds: number = DEFAULT_TOLERANCE_SECONDS
): HookVerifyResult {
	const key = hookKey(secret);
	if (!key) return { ok: false, reason: 'bad_secret' };

	const id = headers.get('webhook-id');
	const ts = headers.get('webhook-timestamp');
	const sigs = headers.get('webhook-signature');
	if (!id || !ts || !sigs) return { ok: false, reason: 'missing' };
	if (!/^\d{1,12}$/.test(ts)) return { ok: false, reason: 'malformed' };
	const timestamp = Number(ts);
	if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return { ok: false, reason: 'stale' };

	const expected = Buffer.from(signHook(key, id, timestamp, rawBody), 'base64');
	for (const entry of sigs.split(' ')) {
		const comma = entry.indexOf(',');
		if (comma < 0 || entry.slice(0, comma) !== 'v1') continue;
		const given = Buffer.from(entry.slice(comma + 1), 'base64');
		if (given.length === expected.length && timingSafeEqual(given, expected)) {
			return { ok: true, id, timestamp };
		}
	}
	return { ok: false, reason: 'bad_signature' };
}
