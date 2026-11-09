import * as Sentry from '@sentry/sveltekit';
import { isMetricsRequest } from '#lib/app-metrics-sentry.js';
import { PUBLIC_SENTRY_DSN } from '$app/env/public';

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

export const handleError = Sentry.handleErrorWithSentry();
