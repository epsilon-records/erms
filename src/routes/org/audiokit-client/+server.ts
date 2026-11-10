import { error, json } from '@sveltejs/kit';
import {
	issueLabelClient,
	LabelClientError,
	rotateLabelClient
} from '#lib/server/audiokit-clients.js';
import { parseKeyRing } from '#lib/server/audiokit-credentials.js';
import { BillingError, LabelClientsBilling } from '#lib/server/audio/billing.js';
import { db as adminDb } from '#lib/server/db/client.js';
import { requireScope } from '#lib/server/guard.js';
import {
	AUDIOKIT_BILLING_URL,
	AUDIOKIT_CREDENTIALS_KEY,
	LABEL_CLIENTS_ADMIN_TOKEN
} from '$app/env/private';
import type { RequestHandler } from './$types';

/**
 * Issue or rotate the signed-in label's AudioKit client (EPSILON-102). An owner action
 * (`roles:manage`): billing's admin token lives on the server and is never given to the browser.
 * The org is the one the member is acting in (their verified membership), never a form field. The
 * new client's key and webhook secret are sealed into the database as they arrive and are not in
 * the response. Needs the owner connection because no database role but the owner can read or
 * write the credentials table; the route checks the caller itself before using it.
 *
 *   POST /org/audiokit-client   action=issue | rotate
 */
export const POST: RequestHandler = async ({ request, locals }) => {
	const member = requireScope(locals, 'roles:manage');
	const action = (await request.formData()).get('action');
	if (action !== 'issue' && action !== 'rotate') error(400, 'action must be issue or rotate.');

	if (!AUDIOKIT_BILLING_URL || !LABEL_CLIENTS_ADMIN_TOKEN || !AUDIOKIT_CREDENTIALS_KEY) {
		error(503, 'Per-label AudioKit clients are not configured.');
	}
	const billing = new LabelClientsBilling(AUDIOKIT_BILLING_URL, LABEL_CLIENTS_ADMIN_TOKEN);
	const admin = {
		orgId: member.orgId,
		actor: { id: locals.user?.id ?? '', kind: 'user' as const }
	};

	try {
		const ring = parseKeyRing(AUDIOKIT_CREDENTIALS_KEY);
		const run = action === 'issue' ? issueLabelClient : rotateLabelClient;
		return json(await run(adminDb(), billing, ring, admin), { status: 201 });
	} catch (err) {
		if (err instanceof LabelClientError) error(err.status, err.message);
		// Billing's code only; its body, and the credentials in it, are never passed on.
		if (err instanceof BillingError) error(502, `Billing refused: ${err.code}`);
		throw err;
	}
};
