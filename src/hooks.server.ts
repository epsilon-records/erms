import { createServerClient } from '@supabase/ssr';
import { redirect } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { PUBLIC_SUPABASE_PUBLISHABLE_KEY, PUBLIC_SUPABASE_URL } from '$app/env/public';
import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/client.js';
import { memberships, orgs } from '#lib/server/db/schema.js';

/** Routes reachable without signing in. */
const PUBLIC_PATHS = ['/login', '/auth/callback'];

export const handle: Handle = async ({ event, resolve }) => {
	event.locals.supabase = createServerClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
		cookies: {
			getAll: () => event.cookies.getAll(),
			setAll: (cookies) => {
				for (const { name, value, options } of cookies) {
					event.cookies.set(name, value, { ...options, path: '/' });
				}
			}
		}
	});

	// getUser() asks Supabase Auth to verify the token; never trust getSession() alone on the server.
	const {
		data: { user }
	} = await event.locals.supabase.auth.getUser();
	event.locals.user = user;
	event.locals.membership = null;

	if (user) {
		const [row] = await db()
			.select({ orgId: memberships.orgId, role: memberships.role, orgName: orgs.name })
			.from(memberships)
			.innerJoin(orgs, eq(orgs.id, memberships.orgId))
			.where(eq(memberships.userId, user.id))
			.limit(1);
		event.locals.membership = row ?? null;
	}

	const isPublic = PUBLIC_PATHS.some((p) => event.url.pathname.startsWith(p));
	if (!user && !isPublic) {
		redirect(303, '/login');
	}

	return resolve(event, {
		filterSerializedResponseHeaders: (name) =>
			name === 'content-range' || name === 'x-supabase-api-version'
	});
};
