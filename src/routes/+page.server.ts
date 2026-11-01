import { catalogStats, recentImports } from '#lib/server/catalog.js';
import { db } from '#lib/server/db/client.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const m = locals.membership;
	const [stats, imports] = m
		? await Promise.all([catalogStats(db(), m.orgId), recentImports(db(), m.orgId)])
		: [null, []];
	return { stats, lastImport: imports[0] ?? null };
};
