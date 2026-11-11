import { describe, expect, it } from 'vitest';
import { generateKey, keyFromHeader, sha256 } from './api-keys.js';
import { ApiError, pageParams, toWire } from './api/v1.js';

describe('API keys', () => {
	it('makes lk_<prefix>_<secret> keys and keeps only their hash', () => {
		const { key, prefix, hash } = generateKey();
		expect(key).toMatch(/^lk_[a-z0-9]{8}_[A-Za-z0-9_-]{43}$/);
		expect(key.startsWith(`lk_${prefix}_`)).toBe(true);
		expect(hash).toBe(sha256(key));
		expect(generateKey().key).not.toBe(key);
	});

	it('reads only a well-formed bearer key', () => {
		const { key } = generateKey();
		expect(keyFromHeader(`Bearer ${key}`)).toBe(key);
		expect(keyFromHeader(key)).toBeNull();
		expect(keyFromHeader('Bearer lk_short_x')).toBeNull();
		expect(keyFromHeader(null)).toBeNull();
	});
});

describe('/v1 helpers', () => {
	it('pages 50 by default, 1 to 200 at most, after a uuid', () => {
		expect(pageParams(new URL('https://x/v1/releases'))).toEqual({ limit: 50, after: null });
		expect(() => pageParams(new URL('https://x/v1/releases?limit=500'))).toThrow(ApiError);
		expect(() => pageParams(new URL('https://x/v1/releases?after=nope'))).toThrow(ApiError);
	});

	it('answers in snake_case, without org ids', () => {
		expect(
			toWire({ orgId: 'o', releaseDate: '2026-01-01', tracks: [{ durationMs: 1, orgId: 'o' }] })
		).toEqual({ release_date: '2026-01-01', tracks: [{ duration_ms: 1 }] });
	});
});
