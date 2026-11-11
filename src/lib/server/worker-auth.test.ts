import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isAuthorizedWorkerRequest } from './worker-auth';

describe('isAuthorizedWorkerRequest', () => {
	it('rejects missing or incorrect bearer credentials', () => {
		expect(isAuthorizedWorkerRequest(new Request('https://example.test'), 'secret')).toBe(false);
		expect(
			isAuthorizedWorkerRequest(
				new Request('https://example.test', { headers: { authorization: 'Bearer wrong' } }),
				'secret'
			)
		).toBe(false);
	});

	it('accepts the configured bearer credential', () => {
		expect(
			isAuthorizedWorkerRequest(
				new Request('https://example.test', { headers: { authorization: 'Bearer secret' } }),
				'secret'
			)
		).toBe(true);
	});

	it('rejects all requests when no worker secret is configured', () => {
		expect(
			isAuthorizedWorkerRequest(
				new Request('https://example.test', { headers: { authorization: 'Bearer secret' } }),
				''
			)
		).toBe(false);
	});
	it('rejects a token of another length, a prefix of the secret and a bare secret', () => {
		const call = (authorization: string) =>
			isAuthorizedWorkerRequest(
				new Request('https://example.test', { headers: { authorization } }),
				'secret'
			);
		expect(call('Bearer secre')).toBe(false);
		expect(call('Bearer secret-and-more')).toBe(false);
		expect(call('secret')).toBe(false);
		expect(call('bearer secret')).toBe(false);
	});

	it('compares in constant time', () => {
		const source = readFileSync(new URL('./worker-auth.ts', import.meta.url), 'utf8');
		expect(source).toContain('timingSafeEqual');
		expect(source).not.toMatch(/===\s*`Bearer/);
	});
});
