import * as Sentry from '@sentry/sveltekit';
import type { HandleClientError } from '@sveltejs/kit/hooks';
import { isMetricsRequest } from '#lib/app-metrics-sentry.js';
import { chunkReloadTarget, isChunkLoadError, reloadOnce } from '#lib/chunk-reload.js';
import { PUBLIC_SENTRY_DSN } from '$app/env/public';
import { navigating, page } from '$app/state';

// Browser error monitoring (shared decision 0003). A no-op when the DSN is unset.
Sentry.init({
	dsn: PUBLIC_SENTRY_DSN,
	environment: __SENTRY_ENVIRONMENT__,
	release: __SENTRY_RELEASE__ ?? undefined,
	tracesSampleRate: PUBLIC_SENTRY_DSN ? 0.1 : 0,
	// The collector must not receive tracing headers or become a fetch breadcrumb.
	tracePropagationTargets: [
		/^\/(?!\/|api\/app-metrics(?:[?#]|$))/,
		/^https:\/\/erms\.epsilonrecords\.com\/(?!api\/app-metrics(?:[?#]|$))/
	],
	integrations: (defaults) => [
		...defaults.filter((i) => i.name !== 'BrowserTracing'),
		Sentry.browserTracingIntegration({
			shouldCreateSpanForRequest: (url) => !isMetricsRequest(url)
		})
	],
	beforeBreadcrumb: (breadcrumb) => (isMetricsRequest(breadcrumb.data?.url) ? null : breadcrumb)
});

// A JS chunk that won't load (a deploy removed it, or the request was cut off) gets one full page
// load instead of a stuck page (EPSILON-191, Sentry LABELKIT-8; see src/lib/chunk-reload.ts).
// SvelteKit's page status is -1 until it has rendered the first page.
const started = () => page.status !== -1;

function sessionStore(): Storage | undefined {
	try {
		return window.sessionStorage;
	} catch {
		return undefined;
	}
}

const reload = (href: string) =>
	reloadOnce(href, {
		storage: sessionStore(),
		now: () => Date.now(),
		assign: (target) => location.assign(target)
	});

// At start-up SvelteKit imports the root layout and error page before anything can catch a
// failure, so it surfaces only as an unhandled rejection. Sentry still reports it.
window.addEventListener('unhandledrejection', (event) => {
	if (!started() && isChunkLoadError(event.reason)) reload(location.href);
});

// Sentry reports every error, a chunk failure included; the reload is extra.
export const handleError: HandleClientError = Sentry.handleErrorWithSentry((caught) => {
	const target = chunkReloadTarget(caught.error, {
		started: started(),
		navigatingTo: navigating.to?.url.href ?? null,
		errorUrl: caught.event.url.href,
		currentUrl: location.href
	});
	if (target) reload(target);
});
