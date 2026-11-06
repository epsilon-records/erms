import * as Sentry from '@sentry/sveltekit';
import { handleErrorWithSentry } from '@sentry/sveltekit';
import { PUBLIC_SENTRY_DSN } from '$app/env/public';

// Browser error monitoring (shared decision 0003). A no-op when the DSN is unset.
Sentry.init({
	dsn: PUBLIC_SENTRY_DSN,
	environment: import.meta.env.MODE,
	tracesSampleRate: PUBLIC_SENTRY_DSN ? 0.1 : 0
});

export const handleError = handleErrorWithSentry();
