import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { createAudioKitClient } from '#lib/server/audio/client.js';
import { submitQueuedJob } from '#lib/server/audiokit-jobs.js';
import { db as adminDb } from '#lib/server/db/client.js';
import { audiokitJobs } from '#lib/server/db/schema.js';
import { masterStorage } from '#lib/server/storage/env.js';
import { isAuthorizedWorkerRequest } from '#lib/server/worker-auth.js';
import { AUDIOKIT_API_KEY, AUDIOKIT_BASE_URL, AUDIOKIT_WEBHOOK_SECRET } from '$app/env/private';
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
	// Simple authentication - in production, use a proper secret
	if (!isAuthorizedWorkerRequest(request)) {
		throw error(401, 'Unauthorized');
	}

	const storage = masterStorage();
	if (!storage) {
		throw error(503, 'Storage not configured');
	}

	const audiokit = createAudioKitClient(
		AUDIOKIT_BASE_URL,
		AUDIOKIT_API_KEY,
		AUDIOKIT_WEBHOOK_SECRET
	);
	if (!audiokit) {
		throw error(503, 'AudioKit client not configured');
	}

	const db = adminDb();
	const now = new Date();
	const minRetryTime = new Date(now.getTime() - MIN_RETRY_DELAY_MS);

	// Find queued jobs that haven't been attempted recently
	const queuedJobs = await db
		.select({ id: audiokitJobs.id, attempts: audiokitJobs.attempts })
		.from(audiokitJobs)
		.where(eq(audiokitJobs.status, 'queued'))
		.orderBy(audiokitJobs.requestedAt)
		.limit(MAX_JOBS_PER_RUN);

	const results = [];
	const webhookUrl = new URL('/api/audiokit/webhook', request.url).toString();
	for (const job of queuedJobs) {
		// Skip if too many attempts
		if (job.attempts >= MAX_ATTEMPTS) {
			await db
				.update(audiokitJobs)
				.set({
					status: 'failed',
					error: { code: 'max_attempts', message: 'Job failed after maximum retry attempts' },
					finishedAt: now
				})
				.where(eq(audiokitJobs.id, job.id));
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
			await submitQueuedJob(db, storage, audiokit, job.id, webhookUrl);
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
