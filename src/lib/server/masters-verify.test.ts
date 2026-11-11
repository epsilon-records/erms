import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyStoredMaster } from './masters';
import type { MasterStorage } from './storage/r2';

/**
 * The server's own check of a stored master (EPSILON-120): it hashes what R2 holds instead of
 * trusting the sha256 the browser reports. Runs without Postgres; masters.test.ts covers the
 * same rule through completeMasterUpload against the database.
 */

const KEY = 'orgs/o/recordings/r/masters/m.wav';
const FILE = new TextEncoder().encode('RIFF\x24\x00\x00\x00WAVEfmt the rest of the audio');
const REAL = createHash('sha256').update(FILE).digest('hex');

/** Storage holding `bytes` at KEY, counting each kind of read. */
function storageWith(bytes: Uint8Array | null, headSize = bytes?.length) {
	const reads = { head: 0, inspect: 0 };
	const storage = {
		async head() {
			reads.head++;
			return bytes ? { size: headSize! } : null;
		},
		async inspect(_key: string, headerBytes: number) {
			reads.inspect++;
			if (!bytes) return null;
			return {
				sha256: createHash('sha256').update(bytes).digest('hex'),
				size: bytes.length,
				start: bytes.slice(0, headerBytes)
			};
		}
	} as unknown as MasterStorage;
	return { storage, reads };
}

describe('verifyStoredMaster', () => {
	it('accepts a file whose stored bytes hash to the reported value, reading it once', async () => {
		const { storage, reads } = storageWith(FILE);
		expect(await verifyStoredMaster(storage, KEY, FILE.length, REAL)).toEqual({
			ok: true,
			sha256: REAL,
			size: FILE.length
		});
		expect(reads).toEqual({ head: 1, inspect: 1 });
	});

	it('refuses a file whose stored bytes do not match the reported sha256', async () => {
		const { storage } = storageWith(FILE);
		const result = await verifyStoredMaster(storage, KEY, FILE.length, 'ab'.repeat(32));
		expect(result).toMatchObject({ ok: false });
	});

	it('refuses a file that is not WAV, whatever hash is reported for it', async () => {
		const mp3 = new TextEncoder().encode('ID3\x04\x00\x00\x00\x00\x00\x00\x00\x00 audio');
		const { storage } = storageWith(mp3);
		const real = createHash('sha256').update(mp3).digest('hex');
		expect(await verifyStoredMaster(storage, KEY, mp3.length, real)).toEqual({
			ok: false,
			reason: 'The uploaded file is not a WAV file.'
		});
	});

	it('refuses a size mismatch from the HEAD alone, without reading the file', async () => {
		const { storage, reads } = storageWith(FILE);
		expect(await verifyStoredMaster(storage, KEY, FILE.length + 1, REAL)).toMatchObject({
			ok: false
		});
		expect(reads.inspect).toBe(0);
	});

	it('refuses when the bytes read differ in length from the HEAD', async () => {
		const { storage } = storageWith(FILE, FILE.length + 5);
		expect(await verifyStoredMaster(storage, KEY, FILE.length + 5, REAL)).toMatchObject({
			ok: false
		});
	});

	it('reports a missing object as not there yet', async () => {
		const { storage } = storageWith(null);
		expect(await verifyStoredMaster(storage, KEY, FILE.length, REAL)).toBeNull();
	});
});
