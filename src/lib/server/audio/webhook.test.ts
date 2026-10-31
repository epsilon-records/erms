import { describe, expect, it } from 'vitest';
import { sign, verify } from './webhook';

/**
 * Fixed test vector, shared with AudioKit so both sides sign identically.
 * secret: "whsec_test", t: 1793440800, body: {"event_id":"evt-1"}
 */
const SECRET = 'whsec_test';
const T = 1793440800;
const BODY = '{"event_id":"evt-1"}';
const VECTOR = 't=1793440800,v1=27d3e5b970e7b39136241354c673e7849a3bceccff29da0b09c76a1d9b73b822';

describe('webhook signatures', () => {
	it('round-trips', () => {
		expect(verify(SECRET, BODY, sign(SECRET, BODY, T), T)).toEqual({ ok: true, timestamp: T });
	});

	it('matches the shared test vector', () => {
		// If the algorithm ever changes, regenerate VECTOR and update AudioKit's copy too.
		expect(sign(SECRET, BODY, T)).toBe(VECTOR);
		expect(verify(SECRET, BODY, VECTOR, T)).toEqual({ ok: true, timestamp: T });
	});

	it('rejects a tampered body', () => {
		const header = sign(SECRET, BODY, T);
		expect(verify(SECRET, '{"event_id":"evt-2"}', header, T)).toEqual({
			ok: false,
			reason: 'bad_signature'
		});
	});

	it('rejects the wrong secret', () => {
		expect(verify('other', BODY, sign(SECRET, BODY, T), T)).toMatchObject({ ok: false });
	});

	it('rejects stale timestamps (replay window 5 minutes)', () => {
		expect(verify(SECRET, BODY, sign(SECRET, BODY, T), T + 301)).toEqual({
			ok: false,
			reason: 'stale'
		});
	});

	it('rejects missing and malformed headers', () => {
		expect(verify(SECRET, BODY, null, T)).toEqual({ ok: false, reason: 'missing' });
		expect(verify(SECRET, BODY, 'garbage', T)).toEqual({ ok: false, reason: 'malformed' });
	});
});
