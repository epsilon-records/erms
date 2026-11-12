import { describe, expect, it } from 'vitest';
import {
	BrandingError,
	checkIcon,
	ICON_MAX_BYTES,
	parseAccent,
	parseDisplayName
} from './branding-settings';

/** The start of a PNG: signature and IHDR with the given size. checkIcon reads only this. */
function pngHeader(width: number, height = width, padTo = 33): Uint8Array {
	const bytes = new Uint8Array(Math.max(33, padTo));
	bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
	bytes.set(
		[...'IHDR'].map((c) => c.charCodeAt(0)),
		12
	);
	const view = new DataView(bytes.buffer);
	view.setUint32(16, width);
	view.setUint32(20, height);
	return bytes;
}

const refused = (fn: () => unknown, message: RegExp) => {
	expect(fn).toThrow(BrandingError);
	expect(fn).toThrow(message);
};

describe('checkIcon', () => {
	it('accepts a square PNG from 32 to 512 px', () => {
		expect(checkIcon(pngHeader(32))).toEqual({ size: 32 });
		expect(checkIcon(pngHeader(192))).toEqual({ size: 192 });
		expect(checkIcon(pngHeader(512))).toEqual({ size: 512 });
	});

	it('refuses anything that is not a PNG', () => {
		refused(
			() => checkIcon(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')),
			/PNG/
		);
		refused(() => checkIcon(new Uint8Array(10)), /PNG/);
		const noIhdr = pngHeader(64);
		noIhdr[12] = 0x58;
		refused(() => checkIcon(noIhdr), /PNG/);
	});

	it('refuses a non-square icon, or one too small or too large', () => {
		refused(() => checkIcon(pngHeader(64, 32)), /square; this one is 64×32/);
		refused(() => checkIcon(pngHeader(16)), /between 32 and 512/);
		refused(() => checkIcon(pngHeader(1024)), /between 32 and 512/);
	});

	it('refuses a file over 32 KB', () => {
		refused(() => checkIcon(pngHeader(64, 64, ICON_MAX_BYTES + 1)), /32 KB/);
		expect(checkIcon(pngHeader(64, 64, ICON_MAX_BYTES))).toEqual({ size: 64 });
	});
});

describe('parseAccent', () => {
	it('normalises a hex colour to lowercase #rrggbb', () => {
		expect(parseAccent('#C6F432')).toBe('#c6f432');
		expect(parseAccent(' c6f432 ')).toBe('#c6f432');
	});

	it('treats blank as the default accent', () => {
		expect(parseAccent('')).toBeNull();
		expect(parseAccent('  ')).toBeNull();
	});

	it('refuses anything else', () => {
		for (const bad of ['lime', '#fff', '#c6f43', '#c6f4322', 'rgb(1,2,3)']) {
			refused(() => parseAccent(bad), /hex colour/);
		}
	});
});

describe('parseDisplayName', () => {
	it('trims, and treats blank as the label name', () => {
		expect(parseDisplayName('  ERMS ')).toBe('ERMS');
		expect(parseDisplayName('')).toBeNull();
	});

	it('refuses more than 60 characters', () => {
		expect(parseDisplayName('x'.repeat(60))).toBe('x'.repeat(60));
		refused(() => parseDisplayName('x'.repeat(61)), /60 characters/);
	});
});
