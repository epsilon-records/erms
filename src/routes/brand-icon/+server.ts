import { error } from '@sveltejs/kit';
import { cachedBrandIcon, iconVersion } from '#lib/server/branding.js';
import type { RequestHandler } from './$types';

/**
 * The tab icon a label's owner set on /org/branding, for the host it is served on. Public: the
 * login page shows it before anyone signs in. The request hook has already resolved this host's
 * brand, so the bytes come from its cache. The layout links `?v=<version>`, so a new icon gets a
 * new URL and the old one can be cached for a year. The cache can change between the hook and
 * here (an owner saves a new icon), so the year-long lifetime is given only when the bytes
 * actually served hash to the requested version.
 */
export const GET: RequestHandler = ({ locals, url }) => {
	const icon = locals.brand.favicon ? cachedBrandIcon(url.host) : null;
	if (!icon) error(404, 'No icon for this label.');
	const v = url.searchParams.get('v');
	const versioned = v !== null && v === iconVersion(icon);
	return new Response(new Uint8Array(icon), {
		headers: {
			'content-type': 'image/png',
			'cache-control': versioned ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
			'x-content-type-options': 'nosniff'
		}
	});
};
