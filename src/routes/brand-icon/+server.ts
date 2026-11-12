import { error } from '@sveltejs/kit';
import { cachedBrandIcon } from '#lib/server/branding.js';
import type { RequestHandler } from './$types';

/**
 * The tab icon a label's owner set on /org/branding, for the host it is served on. Public: the
 * login page shows it before anyone signs in. The request hook has already resolved this host's
 * brand, so the bytes come from its cache. The layout links `?v=<version>`, so a new icon gets a
 * new URL and the old one can be cached for a year.
 */
export const GET: RequestHandler = ({ locals, url }) => {
	const icon = locals.brand.favicon ? cachedBrandIcon(url.host) : null;
	if (!icon) error(404, 'No icon for this label.');
	const versioned = url.searchParams.get('v') === locals.brand.favicon;
	return new Response(new Uint8Array(icon), {
		headers: {
			'content-type': 'image/png',
			'cache-control': versioned ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
			'x-content-type-options': 'nosniff'
		}
	});
};
