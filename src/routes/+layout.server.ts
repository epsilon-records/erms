import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => ({
	user: locals.user ? { id: locals.user.id, email: locals.user.email } : null,
	membership: locals.membership,
	memberships: locals.memberships
});
