import {
	AUDIOKIT_API_KEY,
	AUDIOKIT_BASE_URL,
	AUDIOKIT_CREDENTIALS_KEY,
	AUDIOKIT_FALLBACK_ORG_IDS,
	AUDIOKIT_WEBHOOK_SECRET
} from '$app/env/private';
import type { ClientEnv } from './audiokit-clients.js';

/**
 * The AudioKit client settings the worker and reconcile runs build their providers from:
 * each org's own client (EPSILON-102), with the deployment key as the fallback only for the
 * orgs in AUDIOKIT_FALLBACK_ORG_IDS (EPSILON-135). Undefined when AUDIOKIT_BASE_URL is unset.
 */
export function audiokitClientEnv(): ClientEnv | undefined {
	if (!AUDIOKIT_BASE_URL) return undefined;
	return {
		baseUrl: AUDIOKIT_BASE_URL,
		fallback: {
			apiKey: AUDIOKIT_API_KEY,
			webhookSecret: AUDIOKIT_WEBHOOK_SECRET,
			orgIds: AUDIOKIT_FALLBACK_ORG_IDS
		},
		credentialsKey: AUDIOKIT_CREDENTIALS_KEY
	};
}
