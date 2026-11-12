/**
 * Cloudflare Web Analytics on LabelKit's public, signed-out pages only (shared decisions 0011 and
 * 0016). Signed-in app pages never load the beacon: it reads the address when it sends, and a
 * client-side navigation into the app could hand it a sensitive path. The app has its own
 * first-party metrics instead (EPSILON-107), which this module does not touch.
 *
 * Same guards as audiokit.ai's public loader (audiokit-web#28): a fixed list of paths, no query or
 * fragment in the current address, the document's original navigation or the referrer, one beacon
 * per document, and `spa: false`. On top of that, LabelKit is a single-page app, so a document that
 * has the beacon turns every later navigation into a full page load (`needsFullLoad`).
 */

/**
 * The pages that may carry the beacon, matched exactly. Each is reachable signed out (`/` is the
 * landing page, see `server/landing.ts`; the rest are in `server/public-paths.ts`). Additions need
 * review for what their addresses can contain. `/signup/label`, `/auth/*` and every app route are
 * deliberately absent. `public-analytics.test.ts` pins which pages mount the loader.
 */
export const BEACON_PATHS: readonly string[] = ['/', '/login', '/signup', '/privacy', '/terms'];

/** The one origin with a Cloudflare Web Analytics site. Never previews or customers' domains. */
export const BEACON_ORIGIN = 'https://labelkit.co';

export const BEACON_SRC = 'https://static.cloudflareinsights.com/beacon.min.js';

/** A Cloudflare Web Analytics site token: 32 hex characters. Anything else disables the beacon. */
export function siteToken(value: string | undefined): string | undefined {
	return typeof value === 'string' && /^[a-f0-9]{32}$/i.test(value) ? value : undefined;
}

/** A URL the beacon may see: https, no credentials, query or fragment, and an allowed path. */
function clean(raw: unknown, sameOrigin: boolean): boolean {
	if (typeof raw !== 'string' || !raw || /[?#]/.test(raw)) return false;
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return false;
	}
	if (url.protocol !== 'https:' || url.username || url.password) return false;
	if (!BEACON_PATHS.includes(url.pathname)) return false;
	return !sameOrigin || url.origin === BEACON_ORIGIN;
}

export type BeaconContext = {
	/** The configured site token (PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN). */
	token: string | undefined;
	/** Netlify's build context; only `production` loads the beacon. */
	environment: string;
	/** True when the page was rendered for a signed-in user. */
	signedIn: boolean;
	/** `location.href`. */
	href: string;
	/** `performance.getEntriesByType('navigation')`: the URL this document was loaded from. */
	navigation: readonly { name?: unknown }[];
	/** `document.referrer`. */
	referrer: unknown;
	/** True when this document already has a Cloudflare beacon. */
	installed: boolean;
};

/** Whether this document may load the beacon. Anything unexpected says no. */
export function shouldLoadBeacon(c: BeaconContext): boolean {
	if (!siteToken(c.token)) return false;
	if (c.environment !== 'production' || c.signedIn || c.installed) return false;
	if (!clean(c.href, true)) return false;
	// The document's own load, not a client-side navigation from an app page.
	if (c.navigation.length !== 1 || !clean(c.navigation[0]?.name, true)) return false;
	if (typeof c.referrer !== 'string') return false;
	return c.referrer === '' || clean(c.referrer, false);
}

/** The `data-cf-beacon` attribute: manual install, no single-page-app tracking. */
export function beaconConfig(token: string): string {
	return JSON.stringify({ token, spa: false });
}

/**
 * Once a document has the beacon, any navigation that changes the path or query becomes a full
 * page load, so the beacon never outlives the public page it was loaded on. Only jumps within the
 * same page (`#features`) stay client-side.
 */
export function needsFullLoad(from: string, to: URL | null | undefined): boolean {
	if (!to) return false;
	const current = new URL(from);
	return (
		to.origin !== current.origin || to.pathname !== current.pathname || to.search !== current.search
	);
}
