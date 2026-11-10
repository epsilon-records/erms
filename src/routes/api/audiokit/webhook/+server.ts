import { json, error, text } from '@sveltejs/kit';
import { applyWebhook } from '#lib/server/audiokit-webhook.js';
import { db as adminDb } from '#lib/server/db/client.js';
import { AUDIOKIT_WEBHOOK_SECRET } from '$app/env/private';
import type { RequestHandler } from './$types';

/**
 * The original webhook endpoint, for jobs submitted with the deployment-wide key (an org that has
 * no AudioKit client of its own yet, EPSILON-102). It verifies against that one secret and only
 * touches jobs that were not submitted under a label client. A label's webhooks arrive at
 * /api/audiokit/webhook/{client_id} instead.
 */

export const POST: RequestHandler = async ({ request }) => {
	const rawBody = await request.text();
	const signature = request.headers.get('x-signature');

	if (!AUDIOKIT_WEBHOOK_SECRET) {
		throw error(503, 'AudioKit client not configured');
	}

	const outcome = await applyWebhook(adminDb(), {
		rawBody,
		signature,
		secret: AUDIOKIT_WEBHOOK_SECRET,
		scope: { kind: 'fallback' }
	});
	if (outcome.status === 200) return json(outcome.body);
	if (outcome.status === 404) return text(outcome.message, { status: 404 });
	throw error(outcome.status, outcome.message);
};
