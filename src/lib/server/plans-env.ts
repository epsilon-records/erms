import {
	AUDIOKIT_BILLING_URL,
	LABEL_CLIENTS_ADMIN_TOKEN,
	PLAN_LIMITS_EXEMPT_ORG_IDS,
	PLANS_ENABLED
} from '$app/env/private';
import type { PlansConfig } from './plans.js';

/** Plans configuration from the environment (see plans.ts). */
export function plansConfig(): PlansConfig {
	return {
		enabled: PLANS_ENABLED,
		billingUrl: AUDIOKIT_BILLING_URL,
		adminToken: LABEL_CLIENTS_ADMIN_TOKEN,
		exemptOrgIds: PLAN_LIMITS_EXEMPT_ORG_IDS
	};
}
