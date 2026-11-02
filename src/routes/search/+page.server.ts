import { requireScope } from '#lib/server/guard.js';
import { normalizeQuery, searchCatalog } from '#lib/server/search.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const m = requireScope(locals, 'catalog:read');
	const q = normalizeQuery(url.searchParams.get('q'));
	return { results: await locals.db((tx) => searchCatalog(tx, m.orgId, q)) };
};
