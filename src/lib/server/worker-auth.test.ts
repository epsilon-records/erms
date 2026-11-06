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
});
