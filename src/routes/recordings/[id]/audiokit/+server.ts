import { json, error } from '@sveltejs/kit';
import { queueAudioKitJob, JobError, listJobs } from '#lib/server/audiokit-jobs.js';
import { requireScope } from '#lib/server/guard.js';
import { countAnalysesThisMonth, LIMIT_MESSAGES, limitsFor, lockLimit } from '#lib/server/plans.js';
import { plansConfig } from '#lib/server/plans-env.js';
import type { RequestHandler } from './$types';

/**
 * POST /recordings/:id/audiokit - Queue an AudioKit job for analysis of a recording's master.
 * GET /recordings/:id/audiokit - List AudioKit jobs for this recording.
 */

export const POST: RequestHandler = async ({ params, request, locals, url }) => {
	// CSRF check for JSON endpoints
	if (request.headers.get('origin') !== url.origin) error(403, 'Cross-origin request refused.');

	const m = requireScope(locals, 'catalog:write');
	const body = await request.json().catch(() => error(400, 'Invalid JSON.'));
	const { masterId, ...jobRequest } = body;

	if (!masterId || typeof masterId !== 'string') {
		throw error(400, 'masterId is required');
	}

	try {
		const limits = await limitsFor(plansConfig(), m.orgId);
		const result = await locals.db(async (db) => {
			if (limits) await lockLimit(db, m.orgId, 'analysis');
			if (limits && (await countAnalysesThisMonth(db, m.orgId)) >= limits.analysisJobsPerMonth)
				throw new JobError(402, LIMIT_MESSAGES.analysis(limits.analysisJobsPerMonth));
			return queueAudioKitJob(
				db,
				{ orgId: m.orgId, role: m.role, actor: { id: locals.user!.id, kind: 'user' } },
				params.id,
				masterId,
				jobRequest
			);
		});
		return json(result, { status: 201 });
	} catch (err) {
		if (err instanceof JobError) {
			throw error(err.status, err.message);
		}
		throw err;
	}
};

export const GET: RequestHandler = async ({ params, locals }) => {
	const m = requireScope(locals, 'catalog:read');
	const jobs = await locals.db((db) => listJobs(db, m.orgId, params.id));
	return json({ jobs });
};
