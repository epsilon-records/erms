import { PostHog } from 'posthog-node';
import { POSTHOG_HOST, POSTHOG_PERSONAL_API_KEY, POSTHOG_PROJECT_API_KEY } from '$app/env/private';
import type { FlagSource } from './features.js';
import { posthogFlagSource } from './posthog-flags.js';

let source: FlagSource | null | undefined;

/** The PostHog flag source, or null when the keys aren't set or the client can't start. */
export function flagSource(): FlagSource | null {
	if (source !== undefined) return source;
	if (!POSTHOG_PROJECT_API_KEY || !POSTHOG_PERSONAL_API_KEY) return (source = null);
	return (source = posthogFlagSource(
		() =>
			new PostHog(POSTHOG_PROJECT_API_KEY!, {
				host: POSTHOG_HOST,
				secretKey: POSTHOG_PERSONAL_API_KEY,
				disableGeoip: true
			})
	));
}
