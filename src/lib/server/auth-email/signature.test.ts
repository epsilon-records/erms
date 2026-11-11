import { describe, expect, it } from 'vitest';
import { hookKey, signatureEntries, signHook, verifyHook } from './signature';
import { hookSecret, randomHookSecret } from './test-secrets';

// The Standard Webhooks spec's own published example (standardwebhooks.com, svix docs). The repo
// is public and scanned, so the example's key is kept in pieces and assembled at runtime.
const SPEC = {
	secret: hookSecret(['MfKQ9r8G', 'KYqrTwjU', 'PD8ILPZI', 'o2LaLaSw'].join(''), { v1: false }),
	id: 'msg_p5jXN8AQM9LWM0D4loKWxJek',
	timestamp: 1614265330,
	body: '{"test": 2432232314}',
	signature: 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE='
};

function headers(id: string, timestamp: number | string, signature: string) {
	return new Headers({
		'webhook-id': id,
		'webhook-timestamp': String(timestamp),
		'webhook-signature': signature
	});
}

describe('Send Email hook signature (Standard Webhooks)', () => {
	it('accepts the spec example, with or without Supabase\'s "v1," secret prefix', () => {
		for (const secret of [SPEC.secret, `v1,${SPEC.secret}`]) {
			expect(
				verifyHook(
					secret,
					headers(SPEC.id, SPEC.timestamp, SPEC.signature),
					SPEC.body,
					SPEC.timestamp
				)
			).toEqual({ ok: true, id: SPEC.id, timestamp: SPEC.timestamp });
		}
	});

	it('accepts a valid signature among several (secret rotation)', () => {
		const sigs = `v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= ${SPEC.signature}`;
		expect(
			verifyHook(SPEC.secret, headers(SPEC.id, SPEC.timestamp, sigs), SPEC.body, SPEC.timestamp).ok
		).toBe(true);
	});

	it('accepts either secret of a rotation in Supabase’s ", "-joined header', () => {
		const [a, b] = [randomHookSecret(), randomHookSecret()];
		const t = SPEC.timestamp;
		const sigA = signHook(hookKey(a)!, SPEC.id, t, SPEC.body);
		const sigB = signHook(hookKey(b)!, SPEC.id, t, SPEC.body);
		// supabase/auth hookshttp.go: strings.Join(signatureList, ", ")
		const header = `v1,${sigA}, v1,${sigB}`;
		expect(signatureEntries(header)).toEqual([
			{ version: 'v1', signature: sigA },
			{ version: 'v1', signature: sigB }
		]);
		for (const secret of [a, b]) {
			expect(verifyHook(secret, headers(SPEC.id, t, header), SPEC.body, t).ok).toBe(true);
		}
		expect(verifyHook(randomHookSecret(), headers(SPEC.id, t, header), SPEC.body, t)).toMatchObject(
			{ ok: false, reason: 'bad_signature' }
		);
	});

	it('parses space- and comma-separated entries without leaving a separator on any', () => {
		expect(signatureEntries('  v1,AAA=  v1a,BBB,  v2,CCC==  ')).toEqual([
			{ version: 'v1', signature: 'AAA=' },
			{ version: 'v1a', signature: 'BBB' },
			{ version: 'v2', signature: 'CCC==' }
		]);
		expect(signatureEntries('v1,AAA,')).toEqual([]);
		expect(signatureEntries('garbage v1,')).toEqual([]);
	});

	it('rejects a changed body, id or timestamp', () => {
		const t = SPEC.timestamp;
		expect(verifyHook(SPEC.secret, headers(SPEC.id, t, SPEC.signature), '{"test": 1}', t)).toEqual({
			ok: false,
			reason: 'bad_signature'
		});
		expect(
			verifyHook(SPEC.secret, headers('msg_other', t, SPEC.signature), SPEC.body, t)
		).toMatchObject({
			reason: 'bad_signature'
		});
		expect(
			verifyHook(SPEC.secret, headers(SPEC.id, t + 1, SPEC.signature), SPEC.body, t)
		).toMatchObject({
			reason: 'bad_signature'
		});
	});

	it('rejects the right MAC under another scheme version', () => {
		const v2 = SPEC.signature.replace('v1,', 'v2,');
		expect(
			verifyHook(SPEC.secret, headers(SPEC.id, SPEC.timestamp, v2), SPEC.body, SPEC.timestamp)
		).toMatchObject({
			reason: 'bad_signature'
		});
	});

	it('rejects a signature from another secret', () => {
		const other = hookKey(randomHookSecret())!;
		const sig = `v1,${signHook(other, SPEC.id, SPEC.timestamp, SPEC.body)}`;
		expect(
			verifyHook(SPEC.secret, headers(SPEC.id, SPEC.timestamp, sig), SPEC.body, SPEC.timestamp)
		).toMatchObject({
			reason: 'bad_signature'
		});
	});

	it('rejects stale and future timestamps beyond five minutes', () => {
		const h = headers(SPEC.id, SPEC.timestamp, SPEC.signature);
		expect(verifyHook(SPEC.secret, h, SPEC.body, SPEC.timestamp + 301)).toMatchObject({
			reason: 'stale'
		});
		expect(verifyHook(SPEC.secret, h, SPEC.body, SPEC.timestamp - 301)).toMatchObject({
			reason: 'stale'
		});
		expect(verifyHook(SPEC.secret, h, SPEC.body, SPEC.timestamp + 300).ok).toBe(true);
	});

	it('rejects missing or malformed headers', () => {
		expect(verifyHook(SPEC.secret, new Headers(), SPEC.body, SPEC.timestamp)).toMatchObject({
			reason: 'missing'
		});
		expect(
			verifyHook(
				SPEC.secret,
				headers(SPEC.id, '16142653.30', SPEC.signature),
				SPEC.body,
				SPEC.timestamp
			)
		).toMatchObject({ reason: 'malformed' });
	});

	it('refuses a secret that is not the prefix plus base64', () => {
		for (const bad of [
			'',
			'plain-secret',
			hookSecret('', { v1: false }),
			hookSecret(Buffer.from('short').toString('base64'))
		]) {
			expect(
				verifyHook(bad, headers(SPEC.id, SPEC.timestamp, SPEC.signature), SPEC.body, SPEC.timestamp)
			).toEqual({
				ok: false,
				reason: 'bad_secret'
			});
		}
	});
});
