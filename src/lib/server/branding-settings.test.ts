import { crc32, deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
	BrandingError,
	checkIcon,
	ICON_MAX_BYTES,
	parseAccent,
	parseDisplayName
} from './branding-settings';

/**
 * A real, decodable PNG of the given size (8-bit greyscale, all black), padded with an ancillary
 * chunk to reach `padTo` bytes. Built here so the tests need no image files.
 */
function png(width: number, height = width, padTo = 0): Uint8Array {
	const chunk = (type: string, data: Uint8Array) => {
		const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
		const out = Buffer.alloc(12 + data.length);
		out.writeUInt32BE(data.length, 0);
		body.copy(out, 4);
		out.writeUInt32BE(crc32(body), 8 + data.length);
		return out;
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr.set([8, 0, 0, 0, 0], 8);
	const rows = Buffer.alloc((width + 1) * height);
	const parts = [
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(rows)),
		chunk('IEND', new Uint8Array())
	];
	const size = parts.reduce((n, p) => n + p.length, 0);
	if (padTo > size)
		parts.splice(2, 0, chunk('tEXt', new Uint8Array(Math.max(0, padTo - size - 12))));
	return new Uint8Array(Buffer.concat(parts));
}

const refused = (fn: () => unknown, message: RegExp) => {
	expect(fn).toThrow(BrandingError);
	expect(fn).toThrow(message);
};

describe('checkIcon', () => {
	it('accepts a square PNG from 32 to 512 px', () => {
		expect(checkIcon(png(32))).toEqual({ size: 32 });
		expect(checkIcon(png(192))).toEqual({ size: 192 });
		expect(checkIcon(png(512))).toEqual({ size: 512 });
	});

	it('refuses anything that is not a PNG', () => {
		refused(
			() => checkIcon(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')),
			/PNG/
		);
		refused(() => checkIcon(new Uint8Array(10)), /PNG/);
		const noIhdr = png(64);
		noIhdr[12] = 0x58;
		refused(() => checkIcon(noIhdr), /PNG/);
	});

	it('refuses a PNG header with no decodable image after it', () => {
		const whole = png(64);
		refused(() => checkIcon(whole.subarray(0, 33)), /PNG/); // signature and IHDR only
		refused(() => checkIcon(whole.subarray(0, whole.length - 12)), /PNG/); // no IEND
		const corrupt = new Uint8Array(whole);
		corrupt[45] ^= 0xff; // inside the IDAT data: its CRC no longer matches
		refused(() => checkIcon(corrupt), /PNG/);
	});

	it('refuses image data that inflates past what the header allows', () => {
		// A 32 px header, but 10 MB of zeros compressed behind it: a decompression bomb.
		const bomb = png(32);
		const head = bomb.subarray(0, 33);
		const body = deflateSync(Buffer.alloc(10 * 1024 * 1024));
		const idat = Buffer.alloc(12 + body.length);
		idat.writeUInt32BE(body.length, 0);
		idat.write('IDAT', 4, 'latin1');
		body.copy(idat, 8);
		idat.writeUInt32BE(crc32(idat.subarray(4, 8 + body.length)), 8 + body.length);
		const iend = bomb.subarray(bomb.length - 12);
		const file = new Uint8Array(Buffer.concat([head, idat, iend]));
		expect(file.length).toBeLessThan(ICON_MAX_BYTES);
		refused(() => checkIcon(file), /PNG/);
	});

	it('refuses image data shorter than the header describes', () => {
		// Valid chunks and CRCs, but the IDAT inflates to one byte instead of 32 rows.
		const whole = png(32);
		const head = whole.subarray(0, 33);
		const body = deflateSync(Buffer.alloc(1));
		const idat = Buffer.alloc(12 + body.length);
		idat.writeUInt32BE(body.length, 0);
		idat.write('IDAT', 4, 'latin1');
		body.copy(idat, 8);
		idat.writeUInt32BE(crc32(idat.subarray(4, 8 + body.length)), 8 + body.length);
		const file = new Uint8Array(Buffer.concat([head, idat, whole.subarray(whole.length - 12)]));
		refused(() => checkIcon(file), /PNG/);
	});

	it('refuses a scanline with an invalid filter type', () => {
		// Right length and CRCs, but the first row's filter byte is 5; PNG defines 0 to 4.
		const whole = png(32);
		const head = whole.subarray(0, 33);
		const rows = Buffer.alloc(33 * 32);
		rows[0] = 5;
		const body = deflateSync(rows);
		const idat = Buffer.alloc(12 + body.length);
		idat.writeUInt32BE(body.length, 0);
		idat.write('IDAT', 4, 'latin1');
		body.copy(idat, 8);
		idat.writeUInt32BE(crc32(idat.subarray(4, 8 + body.length)), 8 + body.length);
		const file = new Uint8Array(Buffer.concat([head, idat, whole.subarray(whole.length - 12)]));
		refused(() => checkIcon(file), /PNG/);
		rows[0] = 4; // the same file with a valid filter type is accepted
		const ok = deflateSync(rows);
		const idatOk = Buffer.alloc(12 + ok.length);
		idatOk.writeUInt32BE(ok.length, 0);
		idatOk.write('IDAT', 4, 'latin1');
		ok.copy(idatOk, 8);
		idatOk.writeUInt32BE(crc32(idatOk.subarray(4, 8 + ok.length)), 8 + ok.length);
		const fine = new Uint8Array(Buffer.concat([head, idatOk, whole.subarray(whole.length - 12)]));
		expect(checkIcon(fine)).toEqual({ size: 32 });
	});

	it('refuses a palette image with no PLTE chunk', () => {
		// Colour type 3 (palette), 8-bit, with valid rows of index 0 but no palette to index into.
		const chunk = (type: string, data: Uint8Array) => {
			const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
			const out = Buffer.alloc(12 + data.length);
			out.writeUInt32BE(data.length, 0);
			body.copy(out, 4);
			out.writeUInt32BE(crc32(body), 8 + data.length);
			return out;
		};
		const ihdr = Buffer.alloc(13);
		ihdr.writeUInt32BE(32, 0);
		ihdr.writeUInt32BE(32, 4);
		ihdr.set([8, 3, 0, 0, 0], 8);
		const parts = (plte: boolean) =>
			new Uint8Array(
				Buffer.concat([
					Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
					chunk('IHDR', ihdr),
					...(plte ? [chunk('PLTE', new Uint8Array([0, 0, 0]))] : []),
					chunk('IDAT', deflateSync(Buffer.alloc(33 * 32))),
					chunk('IEND', new Uint8Array())
				])
			);
		refused(() => checkIcon(parts(false)), /PNG/);
		expect(checkIcon(parts(true))).toEqual({ size: 32 });
	});

	describe('chunk structure (PNG spec 5.6)', () => {
		const chunk = (type: string, data: Uint8Array | Buffer = new Uint8Array()) => {
			const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
			const out = Buffer.alloc(12 + data.length);
			out.writeUInt32BE(data.length, 0);
			body.copy(out, 4);
			out.writeUInt32BE(crc32(body), 8 + data.length);
			return out;
		};
		const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
		const ihdr = (colour = 0, size = 32) => {
			const d = Buffer.alloc(13);
			d.writeUInt32BE(size, 0);
			d.writeUInt32BE(size, 4);
			d.set([8, colour, 0, 0, 0], 8);
			return d;
		};
		const rows = () => deflateSync(Buffer.alloc(33 * 32));
		const file = (...parts: Buffer[]) => new Uint8Array(Buffer.concat([SIG, ...parts]));
		const plte = (n: number) => chunk('PLTE', Buffer.alloc(n));

		it('accepts the reference layout, with an ancillary chunk and IDAT split in two', () => {
			const data = rows();
			const half = Math.floor(data.length / 2);
			const ok = file(
				chunk('IHDR', ihdr(3)),
				chunk('tEXt', Buffer.from('a\0b')),
				plte(3),
				chunk('IDAT', data.subarray(0, half)),
				chunk('IDAT', data.subarray(half)),
				chunk('IEND')
			);
			expect(checkIcon(ok)).toEqual({ size: 32 });
		});

		it('refuses an IHDR that is not 13 bytes', () => {
			// 12 bytes of IHDR: the first CRC byte would otherwise be read as the interlace method.
			const short = ihdr().subarray(0, 12);
			refused(
				() => checkIcon(file(chunk('IHDR', short), chunk('IDAT', rows()), chunk('IEND'))),
				/PNG/
			);
		});

		it('refuses a PLTE that is empty, ragged, too long, repeated or after the image data', () => {
			const withPalette = (...mid: Buffer[]) => file(chunk('IHDR', ihdr(3)), ...mid, chunk('IEND'));
			for (const bad of [
				withPalette(plte(0), chunk('IDAT', rows())),
				withPalette(plte(4), chunk('IDAT', rows())),
				withPalette(plte(771), chunk('IDAT', rows())),
				withPalette(plte(3), plte(3), chunk('IDAT', rows())),
				withPalette(chunk('IDAT', rows()), plte(3))
			]) {
				refused(() => checkIcon(bad), /PNG/);
			}
			expect(checkIcon(withPalette(plte(768), chunk('IDAT', rows())))).toEqual({ size: 32 });
		});

		it('refuses IDAT chunks that are not consecutive', () => {
			const data = rows();
			const half = Math.floor(data.length / 2);
			const split = file(
				chunk('IHDR', ihdr()),
				chunk('IDAT', data.subarray(0, half)),
				chunk('tEXt', Buffer.from('a\0b')),
				chunk('IDAT', data.subarray(half)),
				chunk('IEND')
			);
			refused(() => checkIcon(split), /PNG/);
		});

		it('refuses an unknown critical chunk and allows an unknown ancillary one', () => {
			const around = (extra: Buffer) =>
				file(chunk('IHDR', ihdr()), extra, chunk('IDAT', rows()), chunk('IEND'));
			refused(() => checkIcon(around(chunk('ZZZZ', Buffer.from([1])))), /PNG/);
			refused(() => checkIcon(around(chunk('a1b2', Buffer.from([1])))), /PNG/);
			expect(checkIcon(around(chunk('zzZz', Buffer.from([1]))))).toEqual({ size: 32 });
		});

		it('refuses an IEND with data, or bytes after IEND', () => {
			const base = [chunk('IHDR', ihdr()), chunk('IDAT', rows())];
			refused(() => checkIcon(file(...base, chunk('IEND', Buffer.from([0])))), /PNG/);
			refused(() => checkIcon(file(...base, chunk('IEND'), Buffer.from([1, 2, 3]))), /PNG/);
		});
	});

	it('names the icon field in its errors, so the page marks that input', () => {
		try {
			checkIcon(png(16));
		} catch (e) {
			expect((e as BrandingError).field).toBe('icon');
		}
	});

	it('refuses a non-square icon, or one too small or too large', () => {
		refused(() => checkIcon(png(64, 32)), /square; this one is 64×32/);
		refused(() => checkIcon(png(16)), /between 32 and 512/);
		refused(() => checkIcon(png(1024)), /between 32 and 512/);
	});

	it('refuses a file over 32 KB', () => {
		refused(() => checkIcon(png(64, 64, ICON_MAX_BYTES + 1)), /32 KB/);
		expect(checkIcon(png(64, 64, ICON_MAX_BYTES))).toEqual({ size: 64 });
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
