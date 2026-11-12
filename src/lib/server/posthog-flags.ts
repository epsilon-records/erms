import type { FlagSource } from './features.js';

/** The part of the posthog-node client the flag source uses. */
export interface FlagClient {
	isLocalEvaluationReady(): boolean;
	waitForLocalEvaluationReady(timeoutMs?: number): Promise<boolean>;
	isFeatureEnabled(
		key: string,
		distinctId: string,
		options: {
			personProperties: Record<string, string>;
			onlyEvaluateLocally: true;
			sendFeatureFlagEvents: false;
			disableGeoip: true;
		}
	): Promise<boolean | undefined>;
}

/** How long a request waits for flag definitions on a cold start before using defaults. */
export const READY_BUDGET_MS = 300;

/**
 * Wraps a PostHog client as a FlagSource (EPSILON-133).
 * - A client that fails to construct (e.g. a phc_ key in the secret slot) gives no source, so
 *   features take their defaults instead of failing every page.
 * - Until definitions have loaded, a check waits at most READY_BUDGET_MS, then answers "no
 *   answer" (default). The client keeps loading in the background, so later requests see flags.
 */
export function posthogFlagSource(
	create: () => FlagClient,
	log = console.error
): FlagSource | null {
	let client: FlagClient;
	try {
		client = create();
	} catch (e) {
		log('PostHog flag client failed to start; features use their defaults.', e);
		return null;
	}
	return {
		async isEnabled(flag, orgId) {
			if (
				!client.isLocalEvaluationReady() &&
				!(await client.waitForLocalEvaluationReady(READY_BUDGET_MS))
			) {
				return undefined;
			}
			return client.isFeatureEnabled(flag, `org_${orgId}`, {
				personProperties: { org_id: orgId },
				onlyEvaluateLocally: true,
				// No $feature_flag_called events: usage events come later, from an allowlist.
				sendFeatureFlagEvents: false,
				disableGeoip: true
			});
		}
	};
}
