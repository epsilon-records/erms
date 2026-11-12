import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Database } from './audit';
import { orgs } from './db/schema';

/**
 * Per-customer branding by request host (EPSILON-132). A host that is an org's custom domain gets
 * that org's name and accent; every other host (labelkit.co, previews, localhost) gets LabelKit's.
 * The request hook resolves this before sign-in, so the login page on erms.epsilonrecords.com
 * already says "ERMS". It reads only branding columns.
 */
export type Brand = {
	name: string;
	accent: string | null;
	orgId: string | null;
	/** A short version of the label's own tab icon (served at /brand-icon); null: LabelKit's. */
	favicon: string | null;
};

export const DEFAULT_BRAND: Brand = { name: 'LabelKit', accent: null, orgId: null, favicon: null };

/** "ERMS.EpsilonRecords.com:443" → "erms.epsilonrecords.com"; null for an empty host. */
export function normalizeHost(host: string | null | undefined): string | null {
	const h = (host ?? '').trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
	return h || null;
}

const TTL_MS = 60_000;
const cache = new Map<string, { brand: Brand; at: number; icon: Buffer | null }>();

/** The brand for a host, cached per host for a minute. `db` is the owner connection (hook only). */
export async function brandForHost(
	db: Database,
	host: string | null | undefined,
	now = Date.now()
): Promise<Brand> {
	const key = normalizeHost(host);
	if (!key) return DEFAULT_BRAND;
	const hit = cache.get(key);
	if (hit && now - hit.at < TTL_MS) return hit.brand;

	const [row] = await db
		.select({
			id: orgs.id,
			name: orgs.name,
			displayName: orgs.displayName,
			accent: orgs.accentColor,
			faviconPng: orgs.faviconPng
		})
		.from(orgs)
		.where(eq(orgs.customDomain, key))
		.limit(1);
	const icon = row?.faviconPng ? Buffer.from(row.faviconPng, 'base64') : null;
	const brand: Brand = row
		? {
				name: row.displayName ?? row.name,
				accent: row.accent,
				orgId: row.id,
				favicon: icon ? createHash('sha256').update(icon).digest('hex').slice(0, 12) : null
			}
		: DEFAULT_BRAND;
	cache.set(key, { brand, at: now, icon });
	return brand;
}

/**
 * The tab icon brandForHost cached for this host, as PNG bytes; null when the label has none.
 * The request hook resolves the brand first, so /brand-icon reads it without a second query.
 */
export function cachedBrandIcon(host: string | null | undefined): Buffer | null {
	const key = normalizeHost(host);
	return (key && cache.get(key)?.icon) || null;
}

/** Forget cached hosts: after an owner saves new branding, and in tests. */
export function clearBrandCache() {
	cache.clear();
}
