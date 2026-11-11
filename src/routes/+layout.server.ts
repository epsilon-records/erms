import { plansClient } from '#lib/server/plans.js';
import { plansConfig } from '#lib/server/plans-env.js';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => ({
	user: locals.user ? { id: locals.user.id, email: locals.user.email } : null,
	membership: locals.membership,
	memberships: locals.memberships,
	brand: locals.brand,
	// Same check as /org/billing: on, and billing reachable by URL and token.
	plansEnabled: plansClient(plansConfig()) !== null
});
