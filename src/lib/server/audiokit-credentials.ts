import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Sealing for the per-label AudioKit credentials (EPSILON-102). AES-256-GCM, with the key kept in
 * the environment and never in the database, so a dump of `audiokit_label_clients` (the nightly
 * backups, a restored copy, a SQL console) holds nothing usable.
 *
 * `AUDIOKIT_CREDENTIALS_KEY` is a comma-separated ring of `<id>:<base64 of 32 bytes>`. The first
 * entry seals; every entry opens. To rotate it, put the new entry first, redeploy, re-seal, then
 * drop the old one. A sealed value reads `v1.<key id>.<iv>.<tag>.<ciphertext>` (base64url).
 *
 * The associated data names what the value is for (org, client, field), so a sealed value copied
 * to another row, or from the key column to the secret column, fails to open instead of working.
 *
 * Nothing in this module logs or puts a plaintext in an error message.
 */

export type KeyRing = { current: string; keys: Map<string, Buffer> };

export class CredentialSealError extends Error {}

export function parseKeyRing(raw: string | undefined): KeyRing {
	if (!raw) throw new CredentialSealError('AUDIOKIT_CREDENTIALS_KEY is not set');
	const keys = new Map<string, Buffer>();
	let current: string | undefined;
	for (const entry of raw.split(',')) {
		const i = entry.indexOf(':');
		const id = entry.slice(0, i).trim();
		const key = Buffer.from(entry.slice(i + 1).trim(), 'base64');
		if (i < 1 || !/^[A-Za-z0-9_-]{1,32}$/.test(id) || key.length !== 32) {
			throw new CredentialSealError(
				'AUDIOKIT_CREDENTIALS_KEY must be "<id>:<base64 of 32 bytes>", comma-separated'
			);
		}
		if (keys.has(id)) throw new CredentialSealError('AUDIOKIT_CREDENTIALS_KEY repeats a key id');
		keys.set(id, key);
		current ??= id;
	}
	return { current: current as string, keys };
}

export type SealContext = {
	orgId: string;
	clientId: string;
	field: 'api_key' | 'webhook_secret';
};

const aad = (c: SealContext) => Buffer.from(`erms:audiokit:${c.orgId}:${c.clientId}:${c.field}`);

export function seal(ring: KeyRing, plaintext: string, context: SealContext): string {
	const key = ring.keys.get(ring.current) as Buffer;
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	cipher.setAAD(aad(context));
	const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	return [
		'v1',
		ring.current,
		iv.toString('base64url'),
		cipher.getAuthTag().toString('base64url'),
		body.toString('base64url')
	].join('.');
}

export function open(ring: KeyRing, sealed: string, context: SealContext): string {
	const [version, keyId, iv, tag, body, extra] = sealed.split('.');
	const key = keyId ? ring.keys.get(keyId) : undefined;
	if (version !== 'v1' || !key || !iv || !tag || !body || extra !== undefined) {
		throw new CredentialSealError('sealed credential is malformed or its key is not in the ring');
	}
	try {
		const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
		decipher.setAAD(aad(context));
		decipher.setAuthTag(Buffer.from(tag, 'base64url'));
		return Buffer.concat([
			decipher.update(Buffer.from(body, 'base64url')),
			decipher.final()
		]).toString('utf8');
	} catch {
		throw new CredentialSealError('sealed credential did not open (wrong key, row or field)');
	}
}
