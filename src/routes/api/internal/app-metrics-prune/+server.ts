import { sql } from 'drizzle-orm';
import { empty } from '#lib/server/app-metrics.js';
import { isAuthorizedWorkerRequest } from '#lib/server/worker-auth.js';
import type { RequestHandler } from './$types';
export const fallback: RequestHandler = async ({ request, locals }) => {
	if (!isAuthorizedWorkerRequest(request)) return empty(401);
	if (request.method !== 'POST') return empty(405);
	try {
		await locals.db((tx) => tx.execute(sql`select app_metrics.prune()`));
		return empty(204);
	} catch {
		return empty(503);
	}
};
export const POST = fallback;
