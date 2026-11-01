import { listArtists } from '#lib/server/catalog.js';
import { db } from '#lib/server/db/client.js';
import { requireScope } from '#lib/server/guard.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const m = requireScope(locals, 'catalog:read');
	return { artists: await listArtists(db(), m.orgId) };
};
