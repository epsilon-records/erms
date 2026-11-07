import { json, error, text } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { createAudioKitClient } from '#lib/server/audio/client.js';
import { WebhookRejected } from '#lib/server/audio/provider.js';
import { WebhookEvent } from '#lib/server/audio/contract.js';
import { db as adminDb } from '#lib/server/db/client.js';
import { recordSystemAudit } from '#lib/server/audit.js';
import { audiokitJobs, webhookEvents } from '#lib/server/db/schema.js';
import { AUDIOKIT_API_KEY, AUDIOKIT_BASE_URL, AUDIOKIT_WEBHOOK_SECRET } from '$app/env/private';
import type { RequestHandler } from './$types';

/**
 * Webhook endpoint for AudioKit to POST job status updates. Verifies the signature,
 * drops duplicate event_ids, stores provenance, then updates the job with result or error.
 */

export const POST: RequestHandler = async ({ request }) => {
	const rawBody = await request.text();
	const signature = request.headers.get('x-signature');

	const audiokit = createAudioKitClient(
		AUDIOKIT_BASE_URL,
		AUDIOKIT_API_KEY,
		AUDIOKIT_WEBHOOK_SECRET
	);
	if (!audiokit) {
		throw error(503, 'AudioKit client not configured');
	}

	let event: WebhookEvent;
	try {
		event = await audiokit.verifyWebhook(rawBody, signature);
	} catch (err) {
		if (err instanceof WebhookRejected) {
			throw error(400, `Webhook rejected: ${err.reason}`);
		}
		throw err;
	}

	// Validate event structure with Zod
	const parsed = WebhookEvent.safeParse(event);
	if (!parsed.success) {
		throw error(400, 'Invalid webhook event structure');
	}

	const validEvent = parsed.data;
	const { event_id, type: eventType } = validEvent;
	const { job_id: ermsJobId, provider_job_id, provenance, finished_at } = validEvent.data;

	// AudioKit's own finish time, not ERMS's receive time (EPSILON-71).
	const finishedAt = finished_at ? new Date(finished_at) : new Date();

	const db = adminDb();

	// The duplicate check, the job lookup and the update run in one transaction. The
	// `.for('update')` lock only holds inside a transaction, and a failure must not
	// leave the event_id recorded with the job un-updated: AudioKit would retry, hit
	// the duplicate check, and the result would be lost (EPSILON-66).
	const outcome = await db.transaction(async (tx) => {
		// Check if we've already seen this event_id (duplicate webhook)
		const [existingEvent] = await tx
			.select({ eventId: webhookEvents.eventId })
			.from(webhookEvents)
			.where(eq(webhookEvents.eventId, event_id));

		if (existingEvent) return 'duplicate' as const;

		// Find the job by ERMS job_id (which we sent to AudioKit)
		const [job] = await tx
			.select({
				id: audiokitJobs.id,
				providerJobId: audiokitJobs.providerJobId,
				orgId: audiokitJobs.orgId
			})
			.from(audiokitJobs)
			.where(eq(audiokitJobs.id, ermsJobId))
			.for('update');

		if (!job) return 'missing' as const;

		// Verify provider_job_id matches (basic safety check)
		if (job.providerJobId !== provider_job_id) {
			throw error(400, 'provider_job_id mismatch');
		}

		// Record the event_id to prevent duplicate processing
		await tx.insert(webhookEvents).values({
			eventId: event_id,
			eventType,
			jobId: ermsJobId
		});

		// Update job status based on event type
		switch (eventType) {
			case 'job.succeeded':
				await tx
					.update(audiokitJobs)
					.set({
						status: 'succeeded',
						result: validEvent.data.result,
						provenance: provenance ?? null,
						finishedAt
					})
					.where(eq(audiokitJobs.id, ermsJobId));
				break;

			case 'job.failed':
				await tx
					.update(audiokitJobs)
					.set({
						status: 'failed',
						error: validEvent.data.error,
						finishedAt
					})
					.where(eq(audiokitJobs.id, ermsJobId));
				break;

			case 'job.canceled':
				await tx
					.update(audiokitJobs)
					.set({
						status: 'canceled',
						finishedAt
					})
					.where(eq(audiokitJobs.id, ermsJobId));
				break;
		}

		// Audit the machine write in the same transaction (decision 0014).
		await recordSystemAudit(tx, {
			orgId: job.orgId,
			entity: 'audiokit_job',
			entityId: ermsJobId,
			action: 'webhook',
			after: { status: validEvent.data.status, event: eventType }
		});

		return 'processed' as const;
	});

	if (outcome === 'duplicate') {
		// Already processed this webhook, return success to acknowledge
		return json({ received: true, duplicate: true });
	}

	if (outcome === 'missing') {
		// Job not found - this could be a duplicate webhook or wrong job_id
		return text('Job not found', { status: 404 });
	}

	return json({ received: true });
};
