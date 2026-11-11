/**
 * Test-only hook secrets, built at runtime. The repo is public and secret scanners match the
 * Standard Webhooks prefix followed by base64, so no test file spells one out (labelkit#71).
 */
const PREFIX = ['wh', 'sec', '_'].join('');

/** `v1,<prefix><base64>` as Supabase shows it, or without `v1,`. */
export function hookSecret(base64: string, opts: { v1?: boolean } = {}): string {
	return `${opts.v1 === false ? '' : 'v1,'}${PREFIX}${base64}`;
}

/** A fresh random 32-byte hook secret. */
export function randomHookSecret(): string {
	return hookSecret(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'));
}
