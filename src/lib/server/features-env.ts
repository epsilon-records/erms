import { PostHog } from 'posthog-node';
import { POSTHOG_HOST, POSTHOG_PERSONAL_API_KEY, POSTHOG_PROJECT_API_KEY } from '$app/env/private';
import type { FlagSource } from './features.js';

let source: FlagSource | null | undefined;

/** The PostHog flag source, or null when the keys aren't set (features then use their defaults). */
export function flagSource(): FlagSource | null {
	if (source !== undefined) return source;
	if (!POSTHOG_PROJECT_API_KEY || !POSTHOG_PERSONAL_API_KEY) return (source = null);
	const client = new PostHog(POSTHOG_PROJECT_API_KEY, {
		host: POSTHOG_HOST,
		secretKey: POSTHOG_PERSONAL_API_KEY,
		disableGeoip: true
	});
	return (source = {
		isEnabled: (flag, orgId) =>
			client.isFeatureEnabled(flag, `org_${orgId}`, {
				personProperties: { org_id: orgId },
				onlyEvaluateLocally: true,
				// No $feature_flag_called events: usage events come later, from an allowlist.
				sendFeatureFlagEvents: false,
				disableGeoip: true
			})
	});
}
