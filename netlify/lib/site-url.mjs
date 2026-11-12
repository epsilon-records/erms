/**
 * The site a machine function should call back. Netlify's `URL` is the site's main (production)
 * address in every deploy context, so on a deploy preview or branch deploy a function would reach
 * production instead of its own deploy. Outside production, call the deploy's own permalink,
 * `https://<deploy id>--<SITE_NAME>.netlify.app`, built from values Netlify documents as available
 * to functions at runtime (`context.deploy.id`, `SITE_NAME`), never from the request. If they are
 * missing outside production, fail rather than send the worker secret to production.
 *
 * Without a deploy context at all, the main address is used, as before this existed.
 *
 * @param {{ deploy?: { context?: string; id?: string } } | undefined} context
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string | undefined}
 */
export function siteUrlFor(context, env = process.env) {
	const deployContext = context?.deploy?.context;
	if (!deployContext || deployContext === 'production') return env.URL;
	const id = context?.deploy?.id;
	const site = env.SITE_NAME;
	if (!id || !/^[0-9a-z]+$/.test(id) || !site || !/^[a-z0-9-]+$/.test(site)) {
		throw new Error(`Cannot find this ${deployContext}'s own address; refusing to call production`);
	}
	return `https://${id}--${site}.netlify.app`;
}
