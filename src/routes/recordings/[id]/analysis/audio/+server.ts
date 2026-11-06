import { error, redirect } from '@sveltejs/kit';
import { and, desc, eq } from 'drizzle-orm';
import { audiokitJobs } from '#lib/server/db/schema.js';
import { requireScope } from '#lib/server/guard.js';
import { masterStorage } from '#lib/server/storage/env.js';
import type { RequestHandler } from './$types';

/**
 * GET /recordings/:id/analysis/audio - redirect to a short-lived presigned URL for the
 * newest succeeded preview. The signed URL stays out of the page HTML, and the audio never
 * passes through the app (decision 0011).
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	const m = requireScope(locals, 'catalog:read');
	const storage = masterStorage();
	if (!storage) error(503, 'Audio storage is not configured.');

	const [job] = await locals.db((tx) =>
		tx
			.select({ id: audiokitJobs.id })
			.from(audiokitJobs)
			.where(
				and(
					eq(audiokitJobs.orgId, m.orgId),
					eq(audiokitJobs.recordingId, params.id),
					eq(audiokitJobs.operation, 'preview'),
					eq(audiokitJobs.status, 'succeeded')
				)
			)
			.orderBy(desc(audiokitJobs.finishedAt))
			.limit(1)
	);
	if (!job) error(404, 'No preview available.');

	const key = `orgs/${m.orgId}/recordings/${params.id}/audiokit/${job.id}/audio`;
	throw redirect(302, await storage.presignGet(key, 900));
};
