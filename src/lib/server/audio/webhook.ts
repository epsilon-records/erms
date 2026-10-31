import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Webhook signatures: header `X-Signature: t=<unix seconds>,v1=<hex hmac-sha256>`.
 * The signed payload is `${t}.${rawBody}`, so a timestamp can't be swapped onto another body.
 */

export const SIGNATURE_HEADER = 'x-signature';
export const DEFAULT_TOLERANCE_SECONDS = 300;

export function sign(secret: string, rawBody: string, timestamp: number): string {
	const mac = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
	return `t=${timestamp},v1=${mac}`;
}

export type VerifyResult =
	| { ok: true; timestamp: number }
	| { ok: false; reason: 'missing' | 'malformed' | 'stale' | 'bad_signature' };

export function verify(
	secret: string,
	rawBody: string,
	header: string | null,
	nowSeconds: number = Math.floor(Date.now() / 1000),
	toleranceSeconds: number = DEFAULT_TOLERANCE_SECONDS
): VerifyResult {
	if (!header) return { ok: false, reason: 'missing' };

	const parts = Object.fromEntries(
		header.split(',').map((kv) => {
			const i = kv.indexOf('=');
			return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()];
		})
	);
	const t = Number(parts.t);
	const v1 = parts.v1;
	if (!Number.isInteger(t) || !v1 || !/^[0-9a-f]{64}$/.test(v1)) {
		return { ok: false, reason: 'malformed' };
	}
	if (Math.abs(nowSeconds - t) > toleranceSeconds) return { ok: false, reason: 'stale' };

	const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest();
	const given = Buffer.from(v1, 'hex');
	if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
		return { ok: false, reason: 'bad_signature' };
	}
	return { ok: true, timestamp: t };
}
