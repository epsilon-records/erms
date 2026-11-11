import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { providerResolver } from '#lib/server/audiokit-clients.js';
import { dueQueuedJobs, submitQueuedJob } from '#lib/server/audiokit-jobs.js';
import { db as adminDb } from '#lib/server/db/client.js';
import { recordSystemAudit } from '#lib/server/audit.js';
import { audiokitJobs } from '#lib/server/db/schema.js';
import { masterStorage } from '#lib/server/storage/env.js';
import { isAuthorizedWorkerRequest } from '#lib/server/worker-auth.js';
import {
	AUDIOKIT_API_KEY,
	AUDIOKIT_FALLBACK_ORG_IDS,
	AUDIOKIT_BASE_URL,
	AUDIOKIT_CREDENTIALS_KEY,
	AUDIOKIT_WEBHOOK_SECRET
} from '$app/env/private';
import type { RequestHandler } from './$types';

/**
 * Background worker that processes queued AudioKit jobs. This endpoint should be called
 * by a cron job (e.g., Netlify Scheduled Functions or external cron service) to pick up
 * queued jobs and submit them to AudioKit.
 *
 * Authentication: requires a bearer token that matches WORKER_SECRET env var.
 */

const MAX_JOBS_PER_RUN = 10;
const MIN_RETRY_DELAY_MS = 60_000; // 1 minute
const MAX_ATTEMPTS = 5;

export const POST: RequestHandler = async ({ request }) => {
	// Machine endpoint: the shared WORKER_SECRET bearer token (worker-auth.ts).
	if (!isAuthorizedWorkerRequest(request)) {
		throw error(401, 'Unauthorized');
	}

	const storage = masterStorage();
	if (!storage) {
		throw error(503, 'Storage not configured');
	}

	if (!AUDIOKIT_BASE_URL) {
		throw error(503, 'AudioKit client not configured');
	}

	const db = adminDb();
	// Each job is submitted with its own org's AudioKit client (EPSILON-102); an org without one
	// yet fails closed unless it is listed in AUDIOKIT_FALLBACK_ORG_IDS (EPSILON-135).
	const providers = providerResolver(db, {
		baseUrl: AUDIOKIT_BASE_URL,
		fallback: {
			apiKey: AUDIOKIT_API_KEY,
			webhookSecret: AUDIOKIT_WEBHOOK_SECRET,
			orgIds: AUDIOKIT_FALLBACK_ORG_IDS
		},
		credentialsKey: AUDIOKIT_CREDENTIALS_KEY
	});
	const now = new Date();
	const minRetryTime = new Date(now.getTime() - MIN_RETRY_DELAY_MS);

	const queuedJobs = await dueQueuedJobs(db, now, MIN_RETRY_DELAY_MS, MAX_JOBS_PER_RUN);

	const results = [];
	for (const job of queuedJobs) {
		// Skip if too many attempts
		if (job.attempts >= MAX_ATTEMPTS) {
			// Machine write: audit the terminal status change in the same transaction (0014).
			await db.transaction(async (tx) => {
				await tx
					.update(audiokitJobs)
					.set({
						status: 'failed',
						error: { code: 'max_attempts', message: 'Job failed after maximum retry attempts' },
						finishedAt: now
					})
					.where(eq(audiokitJobs.id, job.id));
				await recordSystemAudit(tx, {
					orgId: job.orgId,
					entity: 'audiokit_job',
					entityId: job.id,
					action: 'max_attempts',
					after: { status: 'failed' }
				});
			});
			results.push({ jobId: job.id, status: 'failed', reason: 'max_attempts' });
			continue;
		}

		// Skip if attempted recently (basic backoff)
		const [current] = await db
			.select({ lastAttemptAt: audiokitJobs.lastAttemptAt })
			.from(audiokitJobs)
			.where(eq(audiokitJobs.id, job.id));
		if (current?.lastAttemptAt && current.lastAttemptAt > minRetryTime) {
			results.push({ jobId: job.id, status: 'skipped', reason: 'retry_delay' });
			continue;
		}

		try {
			await submitQueuedJob(db, storage, providers, job.id, request.url);
			results.push({ jobId: job.id, status: 'submitted' });
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			// Update attempt count
			await db
				.update(audiokitJobs)
				.set({
					attempts: job.attempts + 1,
					lastAttemptAt: now
				})
				.where(eq(audiokitJobs.id, job.id));
			results.push({ jobId: job.id, status: 'error', error: message });
		}
	}

	return json({ processed: results.length, results });
};
