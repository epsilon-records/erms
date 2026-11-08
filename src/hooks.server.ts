import { createServerClient } from '@supabase/ssr';
import { error, redirect } from '@sveltejs/kit';
import { sequence, type Handle, type HandleServerError } from '@sveltejs/kit/hooks';
import * as Sentry from '@sentry/sveltekit';
import { PUBLIC_SUPABASE_PUBLISHABLE_KEY, PUBLIC_SUPABASE_URL } from '$app/env/public';
import { SENTRY_DSN } from '$app/env/private';
import { asc, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/client.js';
import { memberships, orgs } from '#lib/server/db/schema.js';
import { scopedTo } from '#lib/server/db/scoped.js';
import { ORG_COOKIE, pickMembership, needsOnboarding } from '#lib/server/org.js';

/**
 * Routes reachable without signing in. `/api/audiokit/` holds machine endpoints that
 * verify their own credentials before running (worker/reconcile require the WORKER_SECRET
 * bearer token; webhook verifies AudioKit's X-Signature HMAC), so the login redirect must
 * not intercept them. Every other path stays behind the sign-in redirect.
 */
const PUBLIC_PATHS = ['/login', '/auth/callback', '/api/audiokit/'];

/** Routes a signed-in member can reach before finishing first-run onboarding. */
const ONBOARDING_EXEMPT = [...PUBLIC_PATHS, '/onboarding', '/logout'];

// Server-side error monitoring (shared decision 0003). A no-op when the DSN is unset.
Sentry.init({
	dsn: SENTRY_DSN,
	environment: __SENTRY_ENVIRONMENT__,
	release: __SENTRY_RELEASE__ ?? undefined,
	tracesSampleRate: SENTRY_DSN ? 0.1 : 0
});

const appHandle: Handle = async ({ event, resolve }) => {
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
	event.locals.memberships = [];
	event.locals.db = () => error(401, 'Sign in first.');

	if (user) {
		// Every query for this request runs as erms_app on behalf of this user, under RLS.
		const scoped = scopedTo(db(), user.id);
		event.locals.db = scoped;
		const rows = await scoped((tx) =>
			tx
				.select({
					orgId: memberships.orgId,
					role: memberships.role,
					orgName: orgs.name,
					onboardedAt: memberships.onboardedAt
				})
				.from(memberships)
				.innerJoin(orgs, eq(orgs.id, memberships.orgId))
				.where(eq(memberships.userId, user.id))
				.orderBy(asc(memberships.createdAt), asc(orgs.name))
		);
		event.locals.memberships = rows;
		event.locals.membership = pickMembership(rows, event.cookies.get(ORG_COOKIE));
	}

	const isPublic = PUBLIC_PATHS.some((p) => event.url.pathname.startsWith(p));
	if (!user && !isPublic) {
		redirect(303, '/login');
	}

	// First run: send a member who hasn't finished onboarding to the welcome page.
	if (needsOnboarding(event.locals.membership, event.url.pathname, ONBOARDING_EXEMPT)) {
		redirect(303, '/onboarding');
	}

	const response = await resolve(event, {
		filterSerializedResponseHeaders: (name) =>
			name === 'content-range' || name === 'x-supabase-api-version'
	});
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
	return response;
};

export const handle = SENTRY_DSN ? sequence(Sentry.sentryHandle(), appHandle) : appHandle;

/** Sent with every server response. The CSP itself comes from SvelteKit (vite.config.ts). */
const SECURITY_HEADERS = {
	'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
	'X-Content-Type-Options': 'nosniff',
	'X-Frame-Options': 'DENY',
	'Referrer-Policy': 'strict-origin-when-cross-origin',
	'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()'
};

/**
 * Unexpected errors: full detail goes to the server log under a short reference, and
 * the browser only sees the reference. Errors raised on purpose with error(), 404s and
 * other framework errors keep their own safe messages.
 */
export const handleError: HandleServerError = Sentry.handleErrorWithSentry((caught) => {
	if (caught.kind !== 'unknown') return;
	const { error: err, event } = caught;
	const ref = crypto.randomUUID().slice(0, 8);
	console.error(
		JSON.stringify({
			level: 'error',
			ref,
			method: event.request.method,
			path: event.url.pathname,
			user: event.locals.user?.id ?? null,
			org: event.locals.membership?.orgId ?? null,
			error: err instanceof Error ? { message: err.message, stack: err.stack } : String(err)
		})
	);
	return { message: `Something went wrong (ref ${ref}).` };
});
