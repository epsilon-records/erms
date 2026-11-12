import type { FlagSource } from './features.js';

/** The part of the posthog-node client the flag source uses. */
export interface FlagClient {
	identifyImmediate(message: {
		distinctId: string;
		properties: Record<string, string>;
		disableGeoip: true;
	}): Promise<void>;
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

/** How long a request waits for the one-off org registration before moving on. */
export const REGISTER_BUDGET_MS = 300;

const within = (ms: number, work: Promise<unknown>) =>
	Promise.race([work.catch(() => undefined), new Promise((r) => setTimeout(r, ms))]);

/**
 * Wraps a PostHog client as a FlagSource (EPSILON-133).
 * - A client that fails to construct (e.g. a phc_ key in the secret slot) gives no source, so
 *   features take their defaults instead of failing every page.
 * - Until definitions have loaded, a check waits at most READY_BUDGET_MS, then answers "no
 *   answer" (default). The client keeps loading in the background, so later requests see flags.
 * - Each org is registered once per server instance: its subject gets the `org_id` property,
 *   so PostHog can offer `org_id` in release conditions. Nothing else is sent (shared 0052).
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
	const registered = new Map<string, Promise<unknown>>();
	const register = (orgId: string) => {
		let done = registered.get(orgId);
		if (!done) {
			done = within(
				REGISTER_BUDGET_MS,
				client.identifyImmediate({
					distinctId: `org_${orgId}`,
					properties: { org_id: orgId },
					disableGeoip: true
				})
			);
			registered.set(orgId, done);
		}
		return done;
	};
	return {
		async isEnabled(flag, orgId) {
			const [, ready] = await Promise.all([
				register(orgId),
				client.isLocalEvaluationReady() || client.waitForLocalEvaluationReady(READY_BUDGET_MS)
			]);
			if (!ready) return undefined;
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
