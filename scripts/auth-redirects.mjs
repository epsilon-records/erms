import { pathToFileURL } from 'node:url';

// The published site must reach the callback on the host that owns the PKCE cookie. labelkit.co is
// the primary site and Supabase Auth's fallback (Site URL); every host the app is served on needs
// its own exact callback allowed, or Supabase silently falls back to the Site URL and sign-in breaks
// (docs/magic-link-redirects.md, EPSILON-134).
export const AUTH_SITE_URL = 'https://labelkit.co';
/**
 * The hosts this check requires: LabelKit itself. A label's own domain gets its callback when its
 * owner sets the domain up on /org/branding (src/lib/server/custom-domain.ts, knowledge labelkit
 * 0036); this patch only ever adds, so those entries are kept.
 */
export const AUTH_HOSTS = [AUTH_SITE_URL];
export const AUTH_CALLBACK_URLS = AUTH_HOSTS.map((host) => `${host}/auth/callback`);

/**
 * A narrow Management API PATCH; preserve unrelated settings and existing redirect entries.
 * @param {{site_url?: string, uri_allow_list?: string} & Record<string, unknown>} current
 */
export function authRedirectPatch(current) {
	const allowed = (current.uri_allow_list ?? '')
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean);
	const patch = {};
	if (current.site_url?.replace(/\/$/, '') !== AUTH_SITE_URL) patch.site_url = AUTH_SITE_URL;
	const missing = AUTH_CALLBACK_URLS.filter((url) => !allowed.includes(url));
	if (missing.length) patch.uri_allow_list = [...allowed, ...missing].join(',');
	return patch;
}

// Read-only: print only the two URL settings, never the rest of Auth config (SMTP secrets).
// --plan prints the proposed PATCH body; it does not send it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const token = process.env.SUPABASE_ACCESS_TOKEN;
	if (!token) throw new Error('Set SUPABASE_ACCESS_TOKEN to a Management API token.');
	const response = await fetch(
		'https://api.supabase.com/v1/projects/efalpthvvmvpaikuxymd/config/auth',
		{ headers: { Authorization: `Bearer ${token}` } }
	);
	if (!response.ok) throw new Error(`Auth config read failed (HTTP ${response.status}).`);
	const patch = authRedirectPatch(await response.json());
	if (process.argv.includes('--plan')) {
		console.log(JSON.stringify(patch, null, 2));
	} else if (Object.keys(patch).length) {
		console.error(
			'Auth redirects do not match the published site. Run with --plan to review the fix.'
		);
		process.exitCode = 1;
	} else {
		console.log('Auth redirects match the published site.');
	}
}
