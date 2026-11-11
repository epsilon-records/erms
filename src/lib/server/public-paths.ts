/**
 * Routes reachable without signing in, matched exactly: a new route is behind the sign-in redirect
 * unless it is added here. `/auth/confirm` is where an invite link lands (EPSILON-87);
 * `/signup/label` sends a visitor with no session on to `/signup` itself.
 */
export const PUBLIC_PAGES: readonly string[] = [
	'/login',
	'/signup',
	'/signup/label',
	'/privacy',
	'/terms',
	'/auth/callback',
	'/auth/confirm'
];

/**
 * Machine endpoints under `/api/audiokit/` verify their own credentials before running
 * (worker and reconcile require the WORKER_SECRET bearer token; the webhooks verify AudioKit's
 * X-Signature HMAC), so the login redirect must not intercept them.
 */
export const MACHINE_ROUTES: readonly string[] = [
	'/api/audiokit/worker',
	'/api/audiokit/reconcile',
	'/api/audiokit/webhook'
];

/** `/api/audiokit/webhook/[client_id]`: exactly one non-empty segment after the prefix. */
const CLIENT_WEBHOOK = /^\/api\/audiokit\/webhook\/[^/]+$/;

export function isMachineRoute(pathname: string): boolean {
	return MACHINE_ROUTES.includes(pathname) || CLIENT_WEBHOOK.test(pathname);
}

export function isPublicPath(pathname: string): boolean {
	return PUBLIC_PAGES.includes(pathname) || isMachineRoute(pathname);
}
