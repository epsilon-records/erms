import { error, redirect } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { masters } from '#lib/server/db/schema.js';
import { requireScope } from '#lib/server/guard.js';
import { masterStorage } from '#lib/server/storage/env.js';
import type { RequestHandler } from './$types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /org/export/masters/:id - download one ready master, for the label's owners. Redirects to a
 * short-lived presigned R2 URL, so the file never passes through the app (decision 0011).
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	const m = requireScope(locals, 'roles:manage');
	if (!UUID.test(params.masterId)) error(404, 'Master not found.');
	const storage = masterStorage();
	if (!storage) error(503, 'Master storage is not configured.');

	const [row] = await locals.db((tx) =>
		tx
			.select({ objectKey: masters.objectKey })
			.from(masters)
			.where(
				and(
					eq(masters.orgId, m.orgId),
					eq(masters.id, params.masterId),
					eq(masters.status, 'ready')
				)
			)
	);
	if (!row) error(404, 'Master not found.');
	redirect(302, await storage.presignGet(row.objectKey, 900));
};
