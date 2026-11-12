import { crc32, inflateSync } from 'node:zlib';
import { eq, sql } from 'drizzle-orm';
import type { Database } from './audit';
import { orgs } from './db/schema';

/**
 * Tenant branding settings, edited by a label's owners on /org/branding: display name, accent
 * colour and tab icon. Every label gets the same settings; no tenant is special-cased in code.
 * Writes go through app.set_org_branding (migration 0031), which checks the owner role and
 * writes the audit log.
 */

export type BrandingField = 'displayName' | 'accent' | 'icon';

export class BrandingError extends Error {
	constructor(
		readonly status: 400 | 403 | 409,
		message: string,
		/** The form field the error is about, so the page can mark that input invalid. */
		readonly field?: BrandingField
	) {
		super(message);
	}
}

export const ICON_MIN_PX = 32;
export const ICON_MAX_PX = 512;
/** 32 KiB of PNG, which fits the column's 44,000-character base64 limit. */
export const ICON_MAX_BYTES = 32 * 1024;

// postgres-js puts the SQLSTATE on the error; drizzle may wrap it in `cause`.
const codeOf = (e: unknown) =>
	(e as { code?: string })?.code ?? (e as { cause?: { code?: string } })?.cause?.code;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Channels per pixel for each PNG colour type; bit depths each type allows. */
const CHANNELS: Record<number, [number, number[]]> = {
	0: [1, [1, 2, 4, 8, 16]], // greyscale
	2: [3, [8, 16]], // RGB
	3: [1, [1, 2, 4, 8]], // palette
	4: [2, [8, 16]], // greyscale + alpha
	6: [4, [8, 16]] // RGBA
};
/** Adam7 passes as [x start, y start, x step, y step]. */
const ADAM7 = [
	[0, 0, 8, 8],
	[4, 0, 8, 8],
	[0, 4, 4, 8],
	[2, 0, 4, 4],
	[0, 2, 2, 4],
	[1, 0, 2, 2],
	[0, 1, 1, 2]
];

/**
 * The scanline layout the IHDR describes: for each pass (one, or Adam7's seven), how many rows
 * and how many pixel bytes per row. Each row is stored as one filter byte then those bytes. Null
 * for a header with an invalid colour type, bit depth, compression, filter or interlace method.
 */
function scanlineLayout(view: DataView): Array<{ rows: number; rowBytes: number }> | null {
	const width = view.getUint32(16);
	const height = view.getUint32(20);
	const depth = view.getUint8(24);
	const colour = CHANNELS[view.getUint8(25)];
	const interlace = view.getUint8(28);
	if (!colour || !colour[1].includes(depth)) return null;
	if (view.getUint8(26) !== 0 || view.getUint8(27) !== 0 || interlace > 1) return null;
	const bits = colour[0] * depth;
	const pass = (w: number, h: number) => ({
		rows: w && h ? h : 0,
		rowBytes: Math.ceil((w * bits) / 8)
	});
	if (interlace === 0) return [pass(width, height)];
	return ADAM7.map(([x0, y0, dx, dy]) =>
		pass(Math.ceil((width - x0) / dx), Math.ceil((height - y0) / dy))
	);
}

/** The critical chunk types PNG defines; any other critical chunk is unreadable to a decoder. */
const CRITICAL = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND']);

const notPng = () => new BrandingError(400, 'The icon must be a PNG file.', 'icon');

/**
 * Walks the PNG's chunks: each must be complete with a correct CRC, the file must end with IEND,
 * a palette image must have a PLTE, and the IDAT data must inflate to exactly the scanlines the
 * header describes, each starting with a valid filter type (0 to 4). Past that, any pixel bytes
 * decode, so a file that passes renders. That refuses a header with no image, a truncated file or
 * a corrupt stream, which would otherwise be saved and then show as a broken icon.
 */
function checkPngBody(bytes: Uint8Array, view: DataView) {
	const idat: Uint8Array[] = [];
	let at = 8;
	let index = 0;
	let ended = false;
	let palette = false;
	let idatClosed = false; // an IDAT run has started and another chunk followed it
	while (at + 12 <= bytes.length && !ended) {
		const length = view.getUint32(at);
		const end = at + 12 + length;
		if (end > bytes.length) throw notPng();
		const typeAndData = bytes.subarray(at + 4, at + 8 + length);
		if (crc32(typeAndData) !== view.getUint32(at + 8 + length)) throw notPng();
		const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
		// The structure rules for PNG's critical chunks (PNG spec, section 5.6): IHDR first and
		// 13 bytes; at most one PLTE, of 1 to 256 three-byte entries, before the image data;
		// IDAT chunks consecutive; IEND empty and last.
		if ((index === 0) !== (type === 'IHDR')) throw notPng();
		// A chunk type is four ASCII letters. An upper-case first letter marks a critical chunk,
		// which a decoder must understand to show the image, so an unknown one is refused;
		// unknown ancillary (lower-case) chunks are skipped by decoders and allowed.
		if (!/^[A-Za-z]{4}$/.test(type)) throw notPng();
		if (/^[A-Z]/.test(type) && !CRITICAL.has(type)) throw notPng();
		if (type === 'IHDR' && length !== 13) throw notPng();
		if (type === 'PLTE') {
			if (palette || idat.length > 0) throw notPng();
			if (length < 3 || length > 768 || length % 3 !== 0) throw notPng();
			palette = true;
		}
		if (type === 'IDAT') {
			if (idatClosed) throw notPng();
			idat.push(bytes.subarray(at + 8, at + 8 + length));
		} else if (idat.length > 0) {
			idatClosed = true;
		}
		if (type === 'IEND' && length !== 0) throw notPng();
		ended = type === 'IEND';
		at = end;
		index++;
	}
	if (!ended || at !== bytes.length || idat.length === 0) throw notPng();
	if (view.getUint8(25) === 3 && !palette) throw notPng();
	// The image data must inflate to exactly the scanline bytes the header describes, and is
	// inflated no further than that: a short stream is a broken image, and a 32 KB upload must not
	// inflate to tens of MB.
	const layout = scanlineLayout(view);
	if (layout === null) throw notPng();
	const expected = layout.reduce((n, p) => n + p.rows * (1 + p.rowBytes), 0);
	let raw: Buffer;
	try {
		raw = inflateSync(Buffer.concat(idat), { maxOutputLength: expected });
	} catch {
		throw notPng();
	}
	if (raw.length !== expected) throw notPng();
	let row = 0;
	for (const { rows, rowBytes } of layout) {
		for (let r = 0; r < rows; r++, row += 1 + rowBytes) {
			if (raw[row] > 4) throw notPng();
		}
	}
}

/** Checks a tab icon upload: a square PNG, 32 to 512 px, at most 32 KiB. Returns its size. */
export function checkIcon(bytes: Uint8Array): { size: number } {
	if (bytes.length > ICON_MAX_BYTES) {
		throw new BrandingError(400, 'The icon must be 32 KB or smaller.', 'icon');
	}
	const isPng = bytes.length >= 33 && PNG_SIGNATURE.every((b, i) => bytes[i] === b);
	// The first chunk of a PNG is IHDR: width and height as big-endian uint32 at bytes 16 and 20.
	const ihdr = isPng && String.fromCharCode(...bytes.subarray(12, 16)) === 'IHDR';
	if (!ihdr) throw notPng();
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const width = view.getUint32(16);
	const height = view.getUint32(20);
	if (width !== height) {
		throw new BrandingError(
			400,
			`The icon must be square; this one is ${width}×${height} px.`,
			'icon'
		);
	}
	if (width < ICON_MIN_PX || width > ICON_MAX_PX) {
		throw new BrandingError(
			400,
			`The icon must be between ${ICON_MIN_PX} and ${ICON_MAX_PX} px square; this one is ${width} px.`,
			'icon'
		);
	}
	checkPngBody(bytes, view);
	return { size: width };
}

/** "  ERMS " → "ERMS"; blank → null (the label's own name). At most 60 characters. */
export function parseDisplayName(input: string): string | null {
	const name = input.trim();
	if (!name) return null;
	if (name.length > 60)
		throw new BrandingError(400, 'The display name can be at most 60 characters.', 'displayName');
	return name;
}

/** "C6F432" or "#c6f432" → "#c6f432"; blank → null (the default accent). */
export function parseAccent(input: string): string | null {
	const hex = input.trim().replace(/^#/, '');
	if (!hex) return null;
	if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
		throw new BrandingError(
			400,
			'The accent colour must be a hex colour such as #c6f432.',
			'accent'
		);
	}
	return `#${hex.toLowerCase()}`;
}

/**
 * What a save does to the icon. 'keep' leaves the stored icon as it is when the database locks the
 * row, so saving only the name or accent cannot undo another owner's upload made in between.
 */
export type IconChange = 'keep' | 'remove' | { png: string };

export type BrandingSettings = {
	displayName: string | null;
	accent: string | null;
	icon: IconChange;
	/**
	 * The name and accent the form was loaded with. When given, the save is refused with a 409 if
	 * another owner changed either since, instead of writing the form's older values over theirs.
	 */
	seen?: { displayName: string | null; accent: string | null };
};

/** Shown when another owner saved while this form was open. */
export const STALE_BRANDING =
	'Another owner changed the branding while you had this page open. The form now shows their version: make your change again and save.';

/** Saves the settings at once, as the signed-in user (an owner), through `locals.db`. */
export async function saveBranding(tx: Database, orgId: string, s: BrandingSettings) {
	const op = typeof s.icon === 'string' ? s.icon : 'replace';
	const png = typeof s.icon === 'string' ? null : s.icon.png;
	const seen = s.seen ?? { displayName: null, accent: null };
	try {
		await tx.execute(
			sql`select app.set_org_branding(${orgId}::uuid, ${s.displayName}, ${s.accent}, ${op}, ${png}, ${s.seen !== undefined}, ${seen.displayName}, ${seen.accent})`
		);
	} catch (e) {
		const code = codeOf(e);
		if (code === '42501') throw new BrandingError(403, 'Only an owner can change the branding.');
		if (code === '40001') throw new BrandingError(409, STALE_BRANDING);
		throw e;
	}
}

/** The label's current settings, read as a member under RLS. */
export async function loadBranding(tx: Database, orgId: string) {
	const [row] = await tx
		.select({
			name: orgs.name,
			displayName: orgs.displayName,
			accent: orgs.accentColor,
			faviconPng: orgs.faviconPng,
			customDomain: orgs.customDomain,
			domainRequested: orgs.domainRequested,
			domainToken: orgs.domainToken,
			domainStatus: orgs.domainStatus,
			domainError: orgs.domainError,
			domainRetired: orgs.domainRetired
		})
		.from(orgs)
		.where(eq(orgs.id, orgId))
		.limit(1);
	return row ?? null;
}
