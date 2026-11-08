import { pathToFileURL } from 'node:url';

// The published site must reach the callback on the host that owns the PKCE cookie.
export const AUTH_SITE_URL = 'https://erms.epsilonrecords.com';
export const AUTH_CALLBACK_URL = `${AUTH_SITE_URL}/auth/callback`;

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
	if (!allowed.includes(AUTH_CALLBACK_URL)) {
		patch.uri_allow_list = [...allowed, AUTH_CALLBACK_URL].join(',');
	}
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
