import { SIGNUP_ENABLED } from '$app/env/private';
import { catalogStats, recentImports } from '#lib/server/catalog.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	// Signed out: the hook only lets / through on LabelKit's own hosts, for the landing page.
	const landing = !locals.user;
	const m = landing ? null : locals.membership;
	const [stats, imports] = m
		? await Promise.all([
				locals.db((tx) => catalogStats(tx, m.orgId)),
				locals.db((tx) => recentImports(tx, m.orgId))
			])
		: [null, []];
	return { landing, signupOpen: SIGNUP_ENABLED, stats, lastImport: imports[0] ?? null };
};
