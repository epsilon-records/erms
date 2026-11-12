import { describe, expect, it } from 'vitest';
import { judge, VerifyResult } from './master-verify';

/**
 * The verdict on a background read of a master (EPSILON-120). Runs without Postgres;
 * masters.test.ts covers leasing and recording it against the database.
 */

const WAV = new TextEncoder().encode('RIFF\x24\x00\x00\x00WAVEfmt ');
const MP3 = new TextEncoder().encode('ID3\x04\x00\x00\x00\x00\x00\x00\x00\x00');
const CLAIM = 'ab'.repeat(32);
const expected = { sizeBytes: 1000, claimedSha256: CLAIM };

describe('judge', () => {
	it('accepts a read that matches the declared size, is WAV and hashes to the claim', () => {
		expect(judge(expected, { sha256: CLAIM, size: 1000, header: WAV })).toEqual({
			ok: true,
			sha256: CLAIM
		});
	});

	it('refuses a read whose hash differs from what the browser reported', () => {
		expect(judge(expected, { sha256: 'cd'.repeat(32), size: 1000, header: WAV })).toMatchObject({
			ok: false
		});
	});

	it('refuses a read that is not WAV, whatever its hash', () => {
		expect(judge(expected, { sha256: CLAIM, size: 1000, header: MP3 })).toEqual({
			ok: false,
			reason: 'The uploaded file is not a WAV file.'
		});
	});

	it('refuses a read of a different size than was declared', () => {
		expect(judge(expected, { sha256: CLAIM, size: 999, header: WAV })).toMatchObject({
			ok: false
		});
	});
});

describe('VerifyResult', () => {
	const ids = { id: '00000000-0000-7000-8000-000000000001', token: crypto.randomUUID() };

	it('accepts a read and an error report', () => {
		expect(
			VerifyResult.safeParse({ ...ids, sha256: CLAIM, size: 1, header: '52494646' }).success
		).toBe(true);
		expect(VerifyResult.safeParse({ ...ids, error: 'timeout' }).success).toBe(true);
	});

	it('refuses a malformed hash, header or id', () => {
		for (const bad of [
			{ ...ids, sha256: 'xyz', size: 1, header: '' },
			{ ...ids, sha256: CLAIM, size: 1, header: '5' },
			{ ...ids, id: 'not-a-uuid', error: 'x' },
			{ ...ids }
		]) {
			expect(VerifyResult.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
		}
	});
});
