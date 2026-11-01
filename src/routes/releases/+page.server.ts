import { listReleases } from '#lib/server/catalog.js';
import { db } from '#lib/server/db/client.js';
import { requireScope } from '#lib/server/guard.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const m = requireScope(locals, 'catalog:read');
	return { releases: await listReleases(db(), m.orgId), q: url.searchParams.get('q') ?? '' };
};
