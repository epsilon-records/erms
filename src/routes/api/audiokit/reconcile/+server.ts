import { json, error } from '@sveltejs/kit';
import { createAudioKitClient } from '#lib/server/audio/client.js';
import { db as adminDb } from '#lib/server/db/client.js';
import { reconcileJobs } from '#lib/server/audiokit-jobs.js';
import { isAuthorizedWorkerRequest } from '#lib/server/worker-auth.js';
import { AUDIOKIT_API_KEY, AUDIOKIT_BASE_URL, AUDIOKIT_WEBHOOK_SECRET } from '$app/env/private';
import type { RequestHandler } from './$types';

/**
 * Reconciliation endpoint: polls AudioKit for jobs that have been submitted but haven't
 * received webhooks. Can be called periodically (e.g., via cron) to catch missed webhooks.
 */

export const POST: RequestHandler = async ({ request }) => {
	if (!isAuthorizedWorkerRequest(request)) {
		throw error(401, 'Unauthorized');
	}

	const audiokit = createAudioKitClient(
		AUDIOKIT_BASE_URL,
		AUDIOKIT_API_KEY,
		AUDIOKIT_WEBHOOK_SECRET
	);
	if (!audiokit) {
		throw error(503, 'AudioKit client not configured');
	}

	const db = adminDb();
	const result = await reconcileJobs(db, audiokit);

	return json({
		checked: result.checked,
		updated: result.updated,
		timestamp: new Date().toISOString()
	});
};
