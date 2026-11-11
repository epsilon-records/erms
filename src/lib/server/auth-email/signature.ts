import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Supabase signs HTTP auth hooks with the Standard Webhooks scheme
 * (https://www.standardwebhooks.com/):
 *
 * - headers `webhook-id`, `webhook-timestamp` (unix seconds) and `webhook-signature`, a list of
 *   `v1,<base64 HMAC-SHA256>`. The spec separates entries with a space; Supabase joins them with
 *   `", "` (one per hook secret, during rotation), so both are accepted;
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
	for (const entry of signatureEntries(sigs)) {
		if (entry.version !== 'v1') continue;
		const given = Buffer.from(entry.signature, 'base64');
		if (given.length === expected.length && timingSafeEqual(given, expected)) {
			return { ok: true, id, timestamp };
		}
	}
	return { ok: false, reason: 'bad_signature' };
}

/**
 * The `version,signature` entries of a `webhook-signature` header. Entries are separated by
 * whitespace, optionally after a comma (`v1,AAA v1,BBB` or Supabase's `v1,AAA, v1,BBB`); an entry
 * that is not `<version>,<base64>` is skipped.
 */
export function signatureEntries(header: string): { version: string; signature: string }[] {
	return header
		.trim()
		.split(/,?\s+/)
		.flatMap((entry) => {
			const m = /^(v\d+[a-z]?),([A-Za-z0-9+/]+={0,2})$/.exec(entry);
			return m ? [{ version: m[1], signature: m[2] }] : [];
		});
}
