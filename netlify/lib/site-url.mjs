/**
 * The site a machine function should call back. Netlify's `URL` is the site's main (production)
 * address in every deploy context, so on a deploy preview or branch deploy a function would reach
 * production instead of its own deploy. Outside production, use the origin the function itself was
 * called on, but only when it is one of this site's own deploy hostnames
 * (`<prefix>--<SITE_NAME>.netlify.app`), because the worker secret is sent to it.
 *
 * @param {Request | undefined} req
 * @param {{ deploy?: { context?: string } } | undefined} context
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string | undefined}
 */
export function siteUrlFor(req, context, env = process.env) {
	const deployContext = context?.deploy?.context;
	if (deployContext && deployContext !== 'production' && req?.url && env.SITE_NAME) {
		try {
			const own = new URL(req.url);
			if (own.protocol === 'https:' && own.hostname.endsWith(`--${env.SITE_NAME}.netlify.app`)) {
				return own.origin;
			}
		} catch {
			// Not a URL: fall back to the main address.
		}
	}
	return env.URL;
}
