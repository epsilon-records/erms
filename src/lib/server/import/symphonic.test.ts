import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	isValidGtin,
	isValidIsrc,
	parseDuration,
	partyMatchKey,
	splitArtists
} from './identifiers';
import {
	MAX_FIELD_CHARS,
	MAX_ROWS,
	normalizeCsvText,
	parseSymphonicInventory,
	summarizePlan
} from './symphonic';

/** 21 real rows from the 2026-11-01 SymphonicMS export, picked for their edge cases. */
const SAMPLE = readFileSync(
	new URL('./__fixtures__/symphonic-sample.csv', import.meta.url),
	'utf8'
);

describe('identifiers', () => {
	it('validates ISRCs and GTINs', () => {
		expect(isValidIsrc('QZWV32595068')).toBe(true);
		expect(isValidIsrc('QZWV3259506')).toBe(false);
		expect(isValidGtin('199502192921')).toBe(true); // UPC-A
		expect(isValidGtin('8720996552049')).toBe(true); // EAN-13
		expect(isValidGtin('199502192922')).toBe(false);
	});

	it('parses track lengths', () => {
		expect(parseDuration('06:16')).toBe(376_000);
		expect(parseDuration('1:02:03')).toBe(3_723_000);
		expect(parseDuration('')).toBeNull();
		expect(parseDuration('abc')).toBeNull();
	});

	it('splits and matches artist names', () => {
		expect(splitArtists('Rich Sibley,Lakeman')).toEqual(['Rich Sibley', 'Lakeman']);
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
		// "Never Stopping (Extended Mix)" is on a single and on the EP.
		const singles = [...plan.releases.values()].filter((r) =>
			r.tracks.some((t) => t.isrc === 'GBWUL2487837')
		);
		expect(singles).toHaveLength(2);
		expect(plan.recordings.get('GBWUL2487837')?.versionTitle).toBe('Extended Mix');
	});

	it('keeps the filled mix version when releases disagree, and warns', () => {
		expect(plan.recordings.get('QZ5FN2405860')?.versionTitle).toBe('Original Mix');
		expect(byCode('recording_version_conflict')).toHaveLength(1);
	});

	it('maps featuring artists and remixers to credit roles', () => {
		const loveMeMore = plan.recordings.get('QZWV32595083')!;
		expect(loveMeMore.credits).toContainEqual({ name: 'Emy Smith', role: 'featured', position: 0 });
		const remix = plan.recordings.get('QZTRX2474228')!;
		expect(remix.credits).toContainEqual({ name: 'Rich Sibley', role: 'remixer', position: 0 });
	});

	it('derives release types', () => {
		expect(plan.releases.get('197999080639')?.type).toBe('compilation'); // ADE sampler
		expect(plan.releases.get('198342669587')?.type).toBe('ep'); // 4 tracks, ~16 min
		expect(plan.releases.get('198342594346')?.type).toBe('single');
	});

	it('warns about missing durations without blocking the import', () => {
		expect(byCode('missing_duration').map((i) => i.level)).toEqual(['warning']);
	});

	it('rejects files that are not inventory exports', () => {
		const bad = parseSymphonicInventory('Name,Email\nNate,nate@example.com\n');
		expect(bad.issues[0]).toMatchObject({ level: 'error', code: 'missing_columns' });
	});

	it('warns when missing lengths leave the release type a guess', async () => {
		const { parse } = await import('csv-parse/sync');
		const rows = parse(SAMPLE, { columns: true, bom: true }) as Record<string, string>[];
		const ep = rows.filter((r) => r.UPC === '198342669587');
		ep[0]['Track Length'] = '';
		const quote = (v: string) => `"${v.replaceAll('"', '""')}"`;
		const csv = [Object.keys(ep[0]), ...ep.map((r) => Object.values(r))]
			.map((cells) => cells.map(quote).join(','))
			.join('\n');
		const guessed = parseSymphonicInventory(csv);
		expect(guessed.releases.get('198342669587')?.type).toBe('ep');
		expect(guessed.issues.filter((i) => i.code === 'type_guessed')).toMatchObject([
			{ level: 'warning' }
		]);
	});

	it('rejects empty files', () => {
		const header = SAMPLE.split('\n')[0];
		for (const text of ['', header + '\n']) {
			expect(parseSymphonicInventory(text).issues[0]).toMatchObject({
				level: 'error',
				code: 'empty_file'
			});
		}
	});

	it('rejects files over the row limit', () => {
		const [header, row] = SAMPLE.split('\n');
		const big = [header, ...Array(MAX_ROWS + 1).fill(row)].join('\n');
		expect(parseSymphonicInventory(big).issues[0]).toMatchObject({ code: 'too_many_rows' });
	});

	it('rejects absurdly long fields', () => {
		const [header, row] = SAMPLE.split('\n');
		const long = row.replace('QZWV32595068', 'X'.repeat(MAX_FIELD_CHARS + 1));
		expect(parseSymphonicInventory([header, long].join('\n')).issues[0]).toMatchObject({
			code: 'field_too_long',
			line: 2
		});
	});

	it('flags bad identifiers and duplicate track numbers', () => {
		const lines = SAMPLE.split('\n');
		const broken = [
			lines[0],
			lines[1].replace('QZWV32595068', 'BADISRC'),
			lines[2],
			lines[2].replace('QZWV32595078', 'QZWV32595079')
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
