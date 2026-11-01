import { catalogStats, recentImports } from '#lib/server/catalog.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const m = locals.membership;
	const [stats, imports] = m
		? await Promise.all([
				locals.db((tx) => catalogStats(tx, m.orgId)),
				locals.db((tx) => recentImports(tx, m.orgId))
			])
		: [null, []];
	return { stats, lastImport: imports[0] ?? null };
};
