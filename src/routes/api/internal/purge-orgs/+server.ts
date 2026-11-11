import { error, json } from '@sveltejs/kit';
import { AUDIOKIT_BILLING_URL, LABEL_CLIENTS_ADMIN_TOKEN } from '$app/env/private';
import { LabelClientsBilling } from '#lib/server/audio/billing.js';
import { db as adminDb } from '#lib/server/db/client.js';
import { duePurges, purgeOrg } from '#lib/server/purge.js';
import { masterStorage } from '#lib/server/storage/env.js';
import { isAuthorizedWorkerRequest } from '#lib/server/worker-auth.js';
import type { RequestHandler } from './$types';

/**
 * POST /api/internal/purge-orgs - the daily purge (netlify/functions/purge-orgs.mjs): deletes labels
 * whose 30-day grace after closing has ended. Worker bearer secret; owner connection, because it
 * deletes across every table a label owns.
 */
export const POST: RequestHandler = async ({ request }) => {
	if (!isAuthorizedWorkerRequest(request)) error(401, 'Unauthorized');
	const db = adminDb();
	const billing =
		AUDIOKIT_BILLING_URL && LABEL_CLIENTS_ADMIN_TOKEN
			? new LabelClientsBilling(AUDIOKIT_BILLING_URL, LABEL_CLIENTS_ADMIN_TOKEN)
			: null;
	const deps = {
		storage: masterStorage(),
		revokeClient: billing ? (id: string) => billing.revoke(id) : null
	};
	const results: { org: string; purged: boolean; error?: string }[] = [];
	for (const { id } of await duePurges(db)) {
		try {
			results.push({ org: id, purged: await purgeOrg(db, id, deps) });
		} catch (e) {
			console.error(JSON.stringify({ level: 'error', msg: 'purge failed', org: id, e: String(e) }));
			results.push({ org: id, purged: false, error: 'failed' });
		}
	}
	return json({ results });
};
