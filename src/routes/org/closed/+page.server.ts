import { error, fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { orgs } from '#lib/server/db/schema.js';
import { hasScope } from '#lib/server/rbac.js';
import { PurgeError, reopenOrg } from '#lib/server/purge.js';
import type { Actions, PageServerLoad } from './$types';

/** A closed label: when it will be deleted, and (for owners) export and reopen. */
export const load: PageServerLoad = async ({ locals }) => {
	const m = locals.membership;
	if (!m) error(403, 'You are not a member of a label.');
	if (!m.closedAt) redirect(303, '/');
	const [row] = await locals.db((tx) =>
		tx.select({ purgeAfter: orgs.purgeAfter }).from(orgs).where(eq(orgs.id, m.orgId))
	);
	return {
		orgName: m.orgName,
		purgeAfter: row?.purgeAfter?.toISOString().slice(0, 10) ?? null,
		isOwner: hasScope(m.role, 'roles:manage'),
		others: locals.memberships.filter((o) => o.orgId !== m.orgId && !o.closedAt)
	};
};

export const actions: Actions = {
	reopen: async ({ locals }) => {
		const m = locals.membership;
		if (!m || !hasScope(m.role, 'roles:manage')) error(403, 'Only an owner can reopen the label.');
		try {
			await locals.db((tx) => reopenOrg(tx, m.orgId));
		} catch (e) {
			if (e instanceof PurgeError) return fail(e.status, { error: e.message });
			throw e;
		}
		redirect(303, '/');
	}
};
