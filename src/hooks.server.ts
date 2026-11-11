import { createServerClient } from '@supabase/ssr';
import { error, redirect } from '@sveltejs/kit';
import { sequence, type Handle, type HandleServerError } from '@sveltejs/kit/hooks';
import * as Sentry from '@sentry/sveltekit';
import { PUBLIC_SUPABASE_PUBLISHABLE_KEY, PUBLIC_SUPABASE_URL } from '$app/env/public';
import { SENTRY_DSN } from '$app/env/private';
import { asc, eq } from 'drizzle-orm';
import { authEmailRunner, metricsRunner } from '#lib/server/db/client.js';
import { AUTH_EMAIL_HOOK_PATH } from '#lib/server/auth-email/hook.js';
import { isMetricsRequest } from '#lib/app-metrics-sentry.js';
import { empty } from '#lib/server/app-metrics.js';
import { isAuthorizedWorkerRequest } from '#lib/server/worker-auth.js';
import { db } from '#lib/server/db/client.js';
import { memberships, orgs } from '#lib/server/db/schema.js';
import { scopedTo } from '#lib/server/db/scoped.js';
import { brandForHost, DEFAULT_BRAND } from '#lib/server/branding.js';
import { isLandingRequest } from '#lib/server/landing.js';
import { ORG_COOKIE, pickMembership, needsOnboarding } from '#lib/server/org.js';

/**
 * Routes reachable without signing in. `/auth/confirm` is where an invite link lands
 * (EPSILON-87). `/api/audiokit/` holds machine endpoints that
 * verify their own credentials before running (worker/reconcile require the WORKER_SECRET
 * bearer token; webhook verifies AudioKit's X-Signature HMAC), so the login redirect must
 * not intercept them. Every other path stays behind the sign-in redirect.
 */
const PUBLIC_PATHS = [
	'/login',
	'/signup',
	'/privacy',
	'/terms',
	'/auth/callback',
	'/auth/confirm',
	'/api/audiokit/'
];

/** Routes a signed-in user with no label can reach; everything else sends them to create one. */
const NO_LABEL_ALLOWED = [...PUBLIC_PATHS, '/logout'];

/** Routes a signed-in member can reach before finishing first-run onboarding. */
const ONBOARDING_EXEMPT = [...PUBLIC_PATHS, '/onboarding', '/logout'];

// Server-side error monitoring (shared decision 0003). A no-op when the DSN is unset.
Sentry.init({
	dsn: SENTRY_DSN,
	environment: __SENTRY_ENVIRONMENT__,
	release: __SENTRY_RELEASE__ ?? undefined,
	tracesSampleRate: SENTRY_DSN ? 0.1 : 0,
	// Kit creates its root span before calling this hook. Suppress that boundary too.
	ignoreSpans: [
		{ attributes: { 'http.route': /^\/api\/(?:app-metrics|internal\/app-metrics-prune)$/ } }
	],
	integrations: (defaults) => [
		...defaults.filter((i) => !['Http', 'Http.Server', 'Http.ServerSpans'].includes(i.name)),
		Sentry.httpIntegration({
			ignoreIncomingRequests: (url) => isMetricsRequest(url),
			ignoreRequestBody: (url) => isMetricsRequest(url)
		})
	],
	beforeSend: (event) => (isMetricsRequest(event.request?.url) ? null : event)
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

	// Per-customer branding by host (EPSILON-132), before sign-in so the login page is branded too.
	// Pages only: API and machine paths never need it and stay off the owner connection here. A
	// failed lookup must never take the login page down: fall back to LabelKit's own branding.
	event.locals.brand = event.url.pathname.startsWith('/api/')
		? DEFAULT_BRAND
		: await Promise.resolve()
				.then(() => brandForHost(db(), event.url.host))
				.catch(() => DEFAULT_BRAND);

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
		// On a customer's own domain, act in that label when the user belongs to it.
		event.locals.membership = pickMembership(
			rows,
			event.locals.brand.orgId ?? event.cookies.get(ORG_COOKIE)
		);
	}

	const isPublic =
		PUBLIC_PATHS.some((p) => event.url.pathname.startsWith(p)) ||
		isLandingRequest(event.url.pathname, event.locals.brand);
	if (!user && !isPublic) {
		redirect(303, '/login');
	}

	// Signed in but in no label (a new self-serve account, or a member who was removed): the only
	// thing to do is create a label (EPSILON-130), which /signup/label explains when signup is off.
	if (
		user &&
		!event.locals.membership &&
		!NO_LABEL_ALLOWED.some((p) => event.url.pathname.startsWith(p))
	) {
		redirect(303, '/signup/label');
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

const ordinaryHandle = SENTRY_DSN ? sequence(Sentry.sentryHandle(), appHandle) : appHandle;
/** Exact anonymous boundary BEFORE Auth, cookies, tenant lookups and Sentry request capture. */
export const handle: Handle = async (input) => {
	const path = input.event.url.pathname;
	// Supabase Auth's Send Email hook (EPSILON-147): a machine caller with no session. It skips
	// cookies, Auth and branding, and gets only the erms_auth_email runner; the route verifies the
	// hook's signature before it uses even that.
	if (path === AUTH_EMAIL_HOOK_PATH) {
		input.event.locals.db = authEmailRunner();
		return input.resolve(input.event);
	}
	if (path === '/api/app-metrics' || path === '/api/internal/app-metrics-prune') {
		if (
			path === '/api/internal/app-metrics-prune' &&
			!isAuthorizedWorkerRequest(input.event.request)
		)
			return empty(401);
		input.event.locals.db = metricsRunner(
			path === '/api/app-metrics' ? 'erms_metrics_ingest' : 'erms_metrics_prune'
		);
		try {
			// Netlify injects W3C trace context after the browser's credential-free fetch.
			// Discard it only at this exact, server-verified hosting boundary; never
			// consume its values or pass it to the receiver, Auth or Sentry.
			let event = input.event;
			if (
				path === '/api/app-metrics' &&
				event.platform?.context?.site?.id === '4d4e8994-934f-4d38-9eb6-5831c09fc6b1'
			) {
				const headers = new Headers(event.request.headers);
				for (const key of ['traceparent', 'tracestate', 'x-amzn-trace-id', 'x-nf-trace-span-id'])
					headers.delete(key);
				event = { ...event, request: new Request(event.request, { headers }) };
			}
			return await Sentry.suppressTracing(() => input.resolve(event));
		} catch {
			return empty(503);
		}
	}
	return ordinaryHandle(input);
};

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
const ordinaryError: HandleServerError = Sentry.handleErrorWithSentry((caught) => {
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

export const handleError: HandleServerError = (caught) => {
	if (['/api/app-metrics', '/api/internal/app-metrics-prune'].includes(caught.event.url.pathname))
		return { message: 'Unavailable' };
	return ordinaryError(caught);
};
