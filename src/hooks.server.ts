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
import { isMachineRoute, isPublicPath, PUBLIC_PAGES } from '#lib/server/public-paths.js';
import { keyFromHeader, resolveApiKey } from '#lib/server/api-keys.js';
import {
	API_INDEX,
	API_MOVED,
	apiHostRoute,
	isApiHost,
	OPENAPI_PATH,
	servesApiForTesting
} from '#lib/server/api-host.js';
import { ORG_COOKIE, pickMembership, needsOnboarding } from '#lib/server/org.js';

/** Routes a signed-in user with no label can reach; everything else sends them to create one. */
const isNoLabelAllowed = (path: string) => isPublicPath(path) || path === '/logout';

/**
 * Routes a member of a closed label can still reach: the closed page, logout, and the export page
 * with the downloads under it (each still checks the member's own access).
 */
const isClosedAllowed = (path: string) =>
	isPublicPath(path) ||
	['/org/closed', '/org/export', '/logout'].includes(path) ||
	path.startsWith('/org/export/');

/** Routes a signed-in member can reach before finishing first-run onboarding. */
const ONBOARDING_EXEMPT = [...PUBLIC_PAGES, '/onboarding', '/logout'];

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
		// Every query for this request runs as labelkit_app on behalf of this user, under RLS.
		const scoped = scopedTo(db(), user.id);
		event.locals.db = scoped;
		const rows = await scoped((tx) =>
			tx
				.select({
					orgId: memberships.orgId,
					role: memberships.role,
					orgName: orgs.name,
					onboardedAt: memberships.onboardedAt,
					closedAt: orgs.closedAt
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
		isPublicPath(event.url.pathname) || isLandingRequest(event.url.pathname, event.locals.brand);
	if (!user && !isPublic) {
		redirect(303, '/login');
	}

	// Signed in but in no label (a new self-serve account, or a member who was removed): the only
	// thing to do is create a label (EPSILON-130), which /signup/label explains when signup is off.
	if (user && !event.locals.membership && !isNoLabelAllowed(event.url.pathname)) {
		redirect(303, '/signup/label');
	}

	// A closed label (migration 0027) does nothing until it is reopened or purged. Owners can still
	// export it and reopen it; everyone else sees the closed page.
	if (
		event.locals.membership?.closedAt &&
		// POST /org switches to another label, which must stay possible.
		event.url.pathname !== '/org' &&
		!isClosedAllowed(event.url.pathname)
	) {
		redirect(303, '/org/closed');
	}

	// First run: send a member who hasn't finished onboarding to the welcome page.
	if (
		!isMachineRoute(event.url.pathname) &&
		needsOnboarding(event.locals.membership, event.url.pathname, ONBOARDING_EXEMPT)
	) {
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
	// api.labelkit.co serves the API and nothing else: no pages, cookies, Auth or machine routes.
	if (isApiHost(input.event.url.host)) {
		const route = apiHostRoute(path);
		if (route === 'api') return apiHandle(input);
		if (route === 'openapi') return publicApiDocument(input);
		return jsonResponse(
			route === 'index' ? 200 : 404,
			route === 'index' ? API_INDEX : { error: { code: 'not_found', message: 'Not found.' } }
		);
	}
	// labelkit.co and custom domains don't serve the API; only local dev and previews still do.
	if (path.startsWith('/v1/') && !servesApiForTesting(input.event.url.host))
		return jsonResponse(404, API_MOVED);
	if (path === OPENAPI_PATH) return publicApiDocument(input);
	// Supabase Auth's Send Email hook (EPSILON-147): a machine caller with no session. It skips
	// cookies, Auth and branding, and gets only the labelkit_auth_email runner; the route verifies the
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
			path === '/api/app-metrics' ? 'labelkit_metrics_ingest' : 'labelkit_metrics_prune'
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
	if (path.startsWith('/v1/')) return apiHandle(input);
	return ordinaryHandle(input);
};

/** A JSON response with the security headers, for the API host's index and 404s. */
function jsonResponse(status: number, body: unknown) {
	const res = new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
	});
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.headers.set(name, value);
	return res;
}

/** The OpenAPI document: public, so it skips the key check and every session lookup. */
const publicApiDocument: Handle = async ({ event, resolve }) => {
	event.locals.user = null;
	event.locals.brand = DEFAULT_BRAND;
	event.locals.memberships = [];
	event.locals.membership = null;
	event.locals.db = () => error(404, 'Not found.');
	const response = await resolve(event);
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
	return response;
};

/**
 * The public /v1 API (EPSILON-137): an `Authorization: Bearer lk_…` key, never a cookie, so no
 * browser session can be ridden into it. The key is looked up on the owner connection; the request
 * then runs as the key's agent under RLS, exactly like a signed-in member.
 */
const apiHandle: Handle = async ({ event, resolve }) => {
	const fail = (status: number, code: string, message: string) => {
		const res = new Response(JSON.stringify({ error: { code, message } }), {
			status,
			headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
		});
		for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.headers.set(name, value);
		return res;
	};
	event.locals.user = null;
	event.locals.brand = DEFAULT_BRAND;
	event.locals.memberships = [];
	event.locals.membership = null;
	event.locals.db = () => error(401, 'Missing or invalid API key.');
	const key = keyFromHeader(event.request.headers.get('authorization'));
	if (!key) return fail(401, 'unauthorized', 'Missing or invalid API key.');
	let resolved;
	try {
		resolved = await resolveApiKey(db(), key);
	} catch {
		return fail(503, 'unavailable', 'The API is unavailable right now.');
	}
	if (!resolved) return fail(401, 'unauthorized', 'Missing or invalid API key.');
	event.locals.membership = { orgId: resolved.orgId, orgName: resolved.orgName, role: 'agent' };
	event.locals.memberships = [event.locals.membership];
	event.locals.apiKey = { id: resolved.id, scopes: resolved.scopes };
	event.locals.db = scopedTo(db(), resolved.actorId);
	const response = await resolve(event);
	for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
	return response;
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
