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
		readonly status: 400 | 403,
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

const notPng = () => new BrandingError(400, 'The icon must be a PNG file.', 'icon');

/**
 * Walks the PNG's chunks: each must be complete with a correct CRC, the file must end with IEND,
 * and its IDAT data must inflate. That refuses a header with no image, or a truncated file, which
 * would otherwise be saved and then show as a broken icon.
 */
function checkPngBody(bytes: Uint8Array, view: DataView) {
	const idat: Uint8Array[] = [];
	let at = 8;
	let ended = false;
	while (at + 12 <= bytes.length && !ended) {
		const length = view.getUint32(at);
		const end = at + 12 + length;
		if (end > bytes.length) throw notPng();
		const typeAndData = bytes.subarray(at + 4, at + 8 + length);
		if (crc32(typeAndData) !== view.getUint32(at + 8 + length)) throw notPng();
		const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
		if (type === 'IDAT') idat.push(bytes.subarray(at + 8, at + 8 + length));
		ended = type === 'IEND';
		at = end;
	}
	if (!ended || idat.length === 0) throw notPng();
	// Bound the inflated size by what the header allows: per row one filter byte and at most 8
	// bytes a pixel (16-bit RGBA), doubled for Adam7 interlacing's extra filter bytes. Without it a
	// 32 KB upload could inflate to tens of MB, synchronously.
	const maxRaw = 2 * view.getUint32(20) * (1 + view.getUint32(16) * 8);
	let raw: Buffer;
	try {
		raw = inflateSync(Buffer.concat(idat), { maxOutputLength: maxRaw });
	} catch {
		throw notPng();
	}
	if (raw.length === 0) throw notPng();
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
};

/** Saves the settings at once, as the signed-in user (an owner), through `locals.db`. */
export async function saveBranding(tx: Database, orgId: string, s: BrandingSettings) {
	const op = typeof s.icon === 'string' ? s.icon : 'replace';
	const png = typeof s.icon === 'string' ? null : s.icon.png;
	try {
		await tx.execute(
			sql`select app.set_org_branding(${orgId}::uuid, ${s.displayName}, ${s.accent}, ${op}, ${png})`
		);
	} catch (e) {
		const code = codeOf(e);
		if (code === '42501') throw new BrandingError(403, 'Only an owner can change the branding.');
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
			customDomain: orgs.customDomain
		})
		.from(orgs)
		.where(eq(orgs.id, orgId))
		.limit(1);
	return row ?? null;
}
