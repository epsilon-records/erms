import { listArtists } from '#lib/server/catalog.js';
import { requireScope } from '#lib/server/guard.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const m = requireScope(locals, 'catalog:read');
	return { artists: await locals.db((tx) => listArtists(tx, m.orgId)) };
};
