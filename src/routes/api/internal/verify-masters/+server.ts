import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { db as adminDb } from '#lib/server/db/client.js';
import { leaseVerifications, recordVerification, VerifyResult } from '#lib/server/master-verify.js';
import { masterStorage } from '#lib/server/storage/env.js';
import { isAuthorizedWorkerRequest } from '#lib/server/worker-auth.js';
import type { RequestHandler } from './$types';

const Body = z.object({ results: z.array(VerifyResult).max(20).optional() });

/**
 * POST /api/internal/verify-masters: the background check of uploaded masters (EPSILON-120).
 * Worker bearer secret; owner connection, because it leases and decides masters in every org.
 *
 * - Without `results` (netlify/functions/master-verify.mjs, every minute): lease the masters
 *   waiting to be checked and answer a presigned GET for each.
 * - With `results` (netlify/functions/master-verify-background.mjs): record what each read found.
 *   A master becomes ready with the server's own hash, is rejected, or is left to be retried.
 */
export const POST: RequestHandler = async ({ request }) => {
	if (!isAuthorizedWorkerRequest(request)) error(401, 'Unauthorized');
	const storage = masterStorage();
	if (!storage) error(503, 'Master storage is not configured');
	const parsed = Body.safeParse(await request.json().catch(() => ({})));
	if (!parsed.success) error(400, 'Invalid request');
	const db = adminDb();

	if (!parsed.data.results) {
		return json({ jobs: await leaseVerifications(db, storage) });
	}
	const outcomes = [];
	for (const result of parsed.data.results) {
		outcomes.push({ id: result.id, outcome: await recordVerification(db, storage, result) });
	}
	return json({ outcomes });
};
