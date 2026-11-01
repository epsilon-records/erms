import { error, redirect } from '@sveltejs/kit';
import { ORG_COOKIE } from '#lib/server/org.js';
import type { RequestHandler } from './$types';

/** Switch the org the user acts in. Only orgs they belong to are accepted. */
export const POST: RequestHandler = async ({ request, locals, cookies }) => {
	const orgId = (await request.formData()).get('orgId');
	if (!locals.memberships.some((m) => m.orgId === orgId)) error(403, 'Not a member of that label.');
	cookies.set(ORG_COOKIE, orgId as string, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: 60 * 60 * 24 * 365
	});
	redirect(303, '/');
};
