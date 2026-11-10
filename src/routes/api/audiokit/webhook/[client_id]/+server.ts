import { json, error, text } from '@sveltejs/kit';
import { credentialsForClient } from '#lib/server/audiokit-clients.js';
import { parseKeyRing } from '#lib/server/audiokit-credentials.js';
import { applyWebhook } from '#lib/server/audiokit-webhook.js';
import { db as adminDb } from '#lib/server/db/client.js';
import { AUDIOKIT_CREDENTIALS_KEY } from '$app/env/private';
import type { RequestHandler } from './$types';

/**
 * Webhook endpoint for one label's AudioKit client (EPSILON-102, knowledge#69). The secret is
 * picked by the client id in the path before the body is parsed. An unknown, pending or revoked
 * client answers 404 and nothing is verified. A webhook signed with one client's secret at
 * another client's URL fails, and so does one for a job of another org.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const POST: RequestHandler = async ({ request, params }) => {
	const clientId = params.client_id.toLowerCase();
	if (!UUID.test(clientId)) return text('Unknown client', { status: 404 });

	const db = adminDb();
	const creds = await credentialsForClient(
		db,
		() => parseKeyRing(AUDIOKIT_CREDENTIALS_KEY),
		clientId
	);
	if (!creds) return text('Unknown client', { status: 404 });

	const rawBody = await request.text();
	const outcome = await applyWebhook(db, {
		rawBody,
		signature: request.headers.get('x-signature'),
		secret: creds.webhookSecret,
		scope: { kind: 'label', clientId, orgId: creds.orgId }
	});
	if (outcome.status === 200) return json(outcome.body);
	if (outcome.status === 404) return text(outcome.message, { status: 404 });
	throw error(outcome.status, outcome.message);
};
