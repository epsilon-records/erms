import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	isValidGtin,
	isValidIsrc,
	parseDuration,
	partyMatchKey,
	splitArtists
} from './identifiers';
import { normalizeCsvText, parseSymphonicInventory, summarizePlan } from './symphonic';

/** 21 rows in the SymphonicMS export format, with invented names and identifiers, picked for their edge cases. */
const SAMPLE = readFileSync(
	new URL('./__fixtures__/symphonic-sample.csv', import.meta.url),
	'utf8'
);

describe('identifiers', () => {
	it('validates ISRCs and GTINs', () => {
		expect(isValidIsrc('ZZAA12595068')).toBe(true);
		expect(isValidIsrc('ZZAA1259506')).toBe(false);
		expect(isValidGtin('000123450102')).toBe(true); // UPC-A
		expect(isValidGtin('8720996552049')).toBe(true); // EAN-13
		expect(isValidGtin('000123450103')).toBe(false);
	});

	it('parses track lengths', () => {
		expect(parseDuration('06:16')).toBe(376_000);
		expect(parseDuration('1:02:03')).toBe(3_723_000);
		expect(parseDuration('')).toBeNull();
		expect(parseDuration('abc')).toBeNull();
	});

	it('splits and matches artist names', () => {
		expect(splitArtists('Rook Sable,Lanthorn')).toEqual(['Rook Sable', 'Lanthorn']);
		expect(partyMatchKey('  Rhythm   ave. ')).toBe('rhythm ave.');
	});
});

describe('parseSymphonicInventory', () => {
	const plan = parseSymphonicInventory(SAMPLE);
	const byCode = (code: string) => plan.issues.filter((i) => i.code === code);

	it('reads the export without errors', () => {
		expect(plan.issues.filter((i) => i.level === 'error')).toEqual([]);
		expect(summarizePlan(plan)).toMatchObject({ rows: 21, releases: 10, labels: 1 });
	});

	it('uses the ISRC as recording identity across releases', () => {
		// "Ever Turning (Extended Mix)" is on a single and on the EP.
		const singles = [...plan.releases.values()].filter((r) =>
			r.tracks.some((t) => t.isrc === 'ZZAA62487837')
		);
		expect(singles).toHaveLength(2);
		expect(plan.recordings.get('ZZAA62487837')?.versionTitle).toBe('Extended Mix');
	});

	it('keeps the filled mix version when releases disagree, and warns', () => {
		expect(plan.recordings.get('ZZAA32405860')?.versionTitle).toBe('Original Mix');
		expect(byCode('recording_version_conflict')).toHaveLength(1);
	});

	it('maps featuring artists and remixers to credit roles', () => {
		const loveMeMore = plan.recordings.get('ZZAA12595083')!;
		expect(loveMeMore.credits).toContainEqual({ name: 'Ema Stone', role: 'featured', position: 0 });
		const remix = plan.recordings.get('ZZAA22474228')!;
		expect(remix.credits).toContainEqual({ name: 'Rook Sable', role: 'remixer', position: 0 });
	});

	it('derives release types', () => {
		expect(plan.releases.get('000123450027')?.type).toBe('compilation'); // fixture sampler
		expect(plan.releases.get('000123450072')?.type).toBe('ep'); // 4 tracks, ~16 min
		expect(plan.releases.get('000123450041')?.type).toBe('single');
	});

	it('warns about missing durations without blocking the import', () => {
		expect(byCode('missing_duration').map((i) => i.level)).toEqual(['warning']);
	});

	it('rejects files that are not inventory exports', () => {
		const bad = parseSymphonicInventory('Name,Email\nNate,nate@example.com\n');
		expect(bad.issues[0]).toMatchObject({ level: 'error', code: 'missing_columns' });
	});

	it('flags bad identifiers and duplicate track numbers', () => {
		const lines = SAMPLE.split('\n');
		const broken = [
			lines[0],
			lines[1].replace('ZZAA12595068', 'BADISRC'),
			lines[2],
			lines[2].replace('ZZAA12595078', 'ZZAA12595079')
		].join('\n');
		const codes = parseSymphonicInventory(broken).issues.map((i) => i.code);
		expect(codes).toContain('bad_isrc');
		expect(codes).toContain('duplicate_track_number');
	});
});

describe('normalizeCsvText', () => {
	it('gives the same text for LF, CRLF and BOM variants of one file', () => {
		const lf = SAMPLE.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
		const crlf = '\uFEFF' + lf.replace(/\n/g, '\r\n');
		expect(normalizeCsvText(crlf)).toBe(normalizeCsvText(lf));
		expect(normalizeCsvText(crlf).startsWith('\uFEFF')).toBe(false);
	});
});
