import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CredentialSealError, open, parseKeyRing, seal } from './audiokit-credentials';

const keyEntry = (id: string) => `${id}:${randomBytes(32).toString('base64')}`;
const ctx = { orgId: 'org-a', clientId: 'client-1', field: 'api_key' } as const;

describe('sealing AudioKit credentials', () => {
	it('opens what it sealed, and the sealed form is not the plaintext', () => {
		const ring = parseKeyRing(keyEntry('k1'));
		const sealed = seal(ring, 'ak_example_key', ctx);
		expect(sealed).not.toContain('ak_example_key');
		expect(open(ring, sealed, ctx)).toBe('ak_example_key');
	});

	it('seals the same value differently each time', () => {
		const ring = parseKeyRing(keyEntry('k1'));
		expect(seal(ring, 'same', ctx)).not.toBe(seal(ring, 'same', ctx));
	});

	it('refuses a value moved to another org, client or field', () => {
		const ring = parseKeyRing(keyEntry('k1'));
		const sealed = seal(ring, 'ak_example_key', ctx);
		for (const other of [
			{ ...ctx, orgId: 'org-b' },
			{ ...ctx, clientId: 'client-2' },
			{ ...ctx, field: 'webhook_secret' as const }
		]) {
			expect(() => open(ring, sealed, other)).toThrow(CredentialSealError);
		}
	});

	it('refuses a tampered value and a wrong key', () => {
		const ring = parseKeyRing(keyEntry('k1'));
		const sealed = seal(ring, 'ak_example_key', ctx);
		const parts = sealed.split('.');
		parts[4] = Buffer.from('tampered').toString('base64url');
		expect(() => open(ring, parts.join('.'), ctx)).toThrow(CredentialSealError);
		expect(() => open(parseKeyRing(keyEntry('k1')), sealed, ctx)).toThrow(CredentialSealError);
	});

	it('seals with the first key and opens with any key in the ring', () => {
		const oldEntry = keyEntry('old');
		const newEntry = keyEntry('new');
		const sealedOld = seal(parseKeyRing(oldEntry), 'v', ctx);
		const ring = parseKeyRing(`${newEntry},${oldEntry}`);
		expect(seal(ring, 'v', ctx).split('.')[1]).toBe('new');
		expect(open(ring, sealedOld, ctx)).toBe('v');
		expect(() => open(parseKeyRing(newEntry), sealedOld, ctx)).toThrow(CredentialSealError);
	});

	it('rejects a missing, short or repeated key', () => {
		expect(() => parseKeyRing(undefined)).toThrow(CredentialSealError);
		expect(() => parseKeyRing('k1:c2hvcnQ=')).toThrow(CredentialSealError);
		expect(() => parseKeyRing('nokey')).toThrow(CredentialSealError);
		const entry = keyEntry('k1');
		expect(() => parseKeyRing(`${entry},${entry}`)).toThrow(CredentialSealError);
	});

	it('never puts the plaintext in an error', () => {
		const ring = parseKeyRing(keyEntry('k1'));
		try {
			open(ring, seal(ring, 'ak_secret_value', ctx), { ...ctx, orgId: 'org-b' });
		} catch (e) {
			expect(String(e)).not.toContain('ak_secret_value');
		}
	});
});
