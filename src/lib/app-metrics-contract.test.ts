import { describe, it, expect } from 'vitest';
import fixtures from '../../tests/fixtures/app-metrics-v1.json';
import { parseSample, routeCode, duration, bucket } from './app-metrics-contract';
it('publishes shared strict golden fixtures', () => {
	for (const value of fixtures.accepted) expect(parseSample(JSON.stringify(value))).toEqual(value);
	for (const value of fixtures.rejected) expect(parseSample(value)).toBeNull();
});
it('maps only literal home framework route identity', () => {
	expect(routeCode('/')).toBe('catalog_home');
	for (const id of [
		null,
		undefined,
		'/releases',
		'/releases/[id]',
		'/artists',
		'/auth/callback',
		'/login',
		'/?token=FAKE',
		'https://example.com/',
		'catalog_home'
	])
		expect(routeCode(id)).toBeNull();
});
describe('strict body grammar', () => {
	const valid = { v: 1, route: 'catalog_home', metric: 'document_mount_ms', ms: 1 };
	for (const ms of [-1, 60001, 1.5, null, '1', {}, [], NaN, Infinity])
		it(`rejects ms ${JSON.stringify(ms)}`, () =>
			expect(parseSample(JSON.stringify({ ...valid, ms }))).toBeNull());
	it('rejects duplicate escaped keys, nested values and malformed objects', () => {
		for (const text of [
			'[]',
			'{}',
			'null',
			'{"v":1,}',
			JSON.stringify(valid).replace('"ms":1', '"ms":1,"\\u006ds":1'),
			JSON.stringify({ ...valid, metric: { secret: 'FAKE' } }),
			JSON.stringify(valid).replace('1}', '1,}')
		])
			expect(parseSample(text)).toBeNull();
	});
});
it('bounds timing before rounding and all histogram edges', () => {
	for (const n of [NaN, Infinity, -0.1, 60000.1]) expect(duration(n)).toBeNull();
	expect(duration(12.6)).toBe(13);
	for (const [n, b] of [
		[0, 1],
		[99, 1],
		[100, 2],
		[249, 2],
		[250, 3],
		[499, 3],
		[500, 4],
		[999, 4],
		[1000, 5],
		[2499, 5],
		[2500, 6],
		[4999, 6],
		[5000, 7],
		[9999, 7],
		[10000, 8],
		[60000, 8]
	])
		expect(bucket(n)).toBe(b);
});
