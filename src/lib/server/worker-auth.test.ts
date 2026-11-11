import * as crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAuthorizedWorkerRequest } from './worker-auth';

// Wrap the real timingSafeEqual so the tests can see which comparison made the decision.
vi.mock('node:crypto', async (importOriginal) => {
	const actual = await importOriginal<typeof import('node:crypto')>();
	return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

const withAuth = (authorization?: string) =>
	new Request('https://example.test', authorization ? { headers: { authorization } } : undefined);

describe('isAuthorizedWorkerRequest', () => {
	afterEach(() => vi.mocked(crypto.timingSafeEqual).mockClear());

	it('rejects missing or incorrect bearer credentials', () => {
		for (const header of [
			undefined,
			'Bearer wrong',
			'Bearer secre',
			'Bearer secretx',
			'bearer secret',
			'secret',
			'Bearer  secret'
		]) {
			expect(isAuthorizedWorkerRequest(withAuth(header), 'secret'), String(header)).toBe(false);
		}
	});

	it('accepts the configured bearer credential', () => {
		expect(isAuthorizedWorkerRequest(withAuth('Bearer secret'), 'secret')).toBe(true);
	});

	it('rejects all requests when no worker secret is configured', () => {
		expect(isAuthorizedWorkerRequest(withAuth('Bearer secret'), '')).toBe(false);
		expect(isAuthorizedWorkerRequest(withAuth('Bearer '), '')).toBe(false);
	});

	it('decides with a constant-time comparison of equal-length values', () => {
		const compare = vi.mocked(crypto.timingSafeEqual);
		for (const [header, expected] of [
			['Bearer secret', true],
			['Bearer wrong', false],
			['Bearer a-much-longer-value-than-the-secret', false]
		] as const) {
			compare.mockClear();
			expect(isAuthorizedWorkerRequest(withAuth(header), 'secret')).toBe(expected);
			expect(compare).toHaveBeenCalledTimes(1);
			const [a, b] = compare.mock.calls[0] as [Buffer, Buffer];
			expect(a.length).toBe(b.length);
			expect(compare.mock.results[0].value).toBe(expected);
		}
	});
});
