import { json, error } from '@sveltejs/kit';
import { advanceLabelClients, providerResolver } from '#lib/server/audiokit-clients.js';
import { LabelClientsBilling } from '#lib/server/audio/billing.js';
import { db as adminDb } from '#lib/server/db/client.js';
import { reconcileJobs } from '#lib/server/audiokit-jobs.js';
import { isAuthorizedWorkerRequest } from '#lib/server/worker-auth.js';
import {
	AUDIOKIT_API_KEY,
	AUDIOKIT_FALLBACK_ORG_IDS,
	AUDIOKIT_BASE_URL,
	AUDIOKIT_BILLING_URL,
	AUDIOKIT_CREDENTIALS_KEY,
	AUDIOKIT_WEBHOOK_SECRET,
	LABEL_CLIENTS_ADMIN_TOKEN
} from '$app/env/private';
import type { RequestHandler } from './$types';

/**
 * Reconciliation endpoint: polls AudioKit for jobs that have been submitted but haven't
 * received webhooks. Can be called periodically (e.g., via cron) to catch missed webhooks.
 */

export const POST: RequestHandler = async ({ request }) => {
	if (!isAuthorizedWorkerRequest(request)) {
		throw error(401, 'Unauthorized');
	}

	if (!AUDIOKIT_BASE_URL) {
		throw error(503, 'AudioKit client not configured');
	}

	const db = adminDb();
	// Each submitted job is polled with the key of the client it was submitted under.
	const providers = providerResolver(db, {
		baseUrl: AUDIOKIT_BASE_URL,
		fallback: {
			apiKey: AUDIOKIT_API_KEY,
			webhookSecret: AUDIOKIT_WEBHOOK_SECRET,
			orgIds: AUDIOKIT_FALLBACK_ORG_IDS
		},
		credentialsKey: AUDIOKIT_CREDENTIALS_KEY
	});
	const result = await reconcileJobs(db, providers);

	// Move label clients along: activate a synced replacement, retire a drained client. Needs
	// billing; without it the clients simply stay as they are.
	const clients =
		AUDIOKIT_BILLING_URL && LABEL_CLIENTS_ADMIN_TOKEN
			? await advanceLabelClients(
					db,
					new LabelClientsBilling(AUDIOKIT_BILLING_URL, LABEL_CLIENTS_ADMIN_TOKEN)
				)
			: null;

	return json({
		checked: result.checked,
		updated: result.updated,
		clients,
		timestamp: new Date().toISOString()
	});
};
