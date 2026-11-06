import { redirect } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';

/**
 * First-run onboarding. A member is sent here once (see hooks.server.ts) until they
 * finish; the flag lives on their membership, so it's per org.
 */
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user || !locals.membership) {
		redirect(303, '/login');
	}

	return {
		orgName: locals.membership.orgName,
		role: locals.membership.role
	};
};

export const actions: Actions = {
	default: async ({ locals }) => {
		if (!locals.user || !locals.membership) {
			redirect(303, '/login');
		}

		// The app role can't update memberships; this stamps only the caller's own row.
		const orgId = locals.membership.orgId;
		await locals.db((tx) => tx.execute(sql`select app.complete_onboarding(${orgId}::uuid)`));

		redirect(303, '/');
	}
};
