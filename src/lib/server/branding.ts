import { eq } from 'drizzle-orm';
import type { Database } from './audit';
import { orgs } from './db/schema';

/**
 * Per-customer branding by request host (EPSILON-132). A host that is an org's custom domain gets
 * that org's name and accent; every other host (labelkit.co, previews, localhost) gets LabelKit's.
 * The request hook resolves this before sign-in, so the login page on erms.epsilonrecords.com
 * already says "ERMS". It reads only branding columns.
 */
export type Brand = { name: string; accent: string | null; orgId: string | null };

export const DEFAULT_BRAND: Brand = { name: 'LabelKit', accent: null, orgId: null };

/** "ERMS.EpsilonRecords.com:443" → "erms.epsilonrecords.com"; null for an empty host. */
export function normalizeHost(host: string | null | undefined): string | null {
	const h = (host ?? '').trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
	return h || null;
}

/**
 * The tab icon per customer domain, kept in code (no database column): a customer whose own mark
 * should replace LabelKit's in the browser tab. Every other host gets LabelKit's icon.
 */
export type BrandIcon = 'labelkit' | 'epsilon';
const BRAND_ICONS: Record<string, BrandIcon> = {
	'erms.epsilonrecords.com': 'epsilon'
};

/** "ERMS.EpsilonRecords.com:443" → "epsilon"; "labelkit.co" → "labelkit". */
export function brandIcon(host: string | null | undefined): BrandIcon {
	const key = normalizeHost(host);
	return (key && BRAND_ICONS[key]) || 'labelkit';
}

const TTL_MS = 60_000;
const cache = new Map<string, { brand: Brand; at: number }>();

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
			accent: orgs.accentColor
		})
		.from(orgs)
		.where(eq(orgs.customDomain, key))
		.limit(1);
	const brand: Brand = row
		? { name: row.displayName ?? row.name, accent: row.accent, orgId: row.id }
		: DEFAULT_BRAND;
	cache.set(key, { brand, at: now });
	return brand;
}

/** For tests: forget cached hosts. */
export function clearBrandCache() {
	cache.clear();
}
