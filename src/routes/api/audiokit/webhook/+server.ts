import { json, error, text } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { createAudioKitClient } from '#lib/server/audio/client.js';
import { WebhookRejected } from '#lib/server/audio/provider.js';
import { WebhookEvent } from '#lib/server/audio/contract.js';
import { db as adminDb } from '#lib/server/db/client.js';
import { audiokitJobs, webhookEvents } from '#lib/server/db/schema.js';
import {
	AUDIOKIT_API_KEY,
	AUDIOKIT_BASE_URL,
	AUDIOKIT_WEBHOOK_SECRET
} from '$app/env/private';
import type { RequestHandler } from './$types';

/**
 * Webhook endpoint for AudioKit to POST job status updates. Verifies the signature,
 * drops duplicate event_ids, stores provenance, then updates the job with result or error.
 */

export const POST: RequestHandler = async ({ request }) => {
	const rawBody = await request.text();
	const signature = request.headers.get('x-signature');

	const audiokit = createAudioKitClient(AUDIOKIT_BASE_URL, AUDIOKIT_API_KEY, AUDIOKIT_WEBHOOK_SECRET);
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
	const { job_id: ermsJobId, provider_job_id, provenance } = validEvent.data;

	const db = adminDb();

	// Check if we've already seen this event_id (duplicate webhook)
	const [existingEvent] = await db
		.select({ eventId: webhookEvents.eventId })
		.from(webhookEvents)
		.where(eq(webhookEvents.eventId, event_id));

	if (existingEvent) {
		// Already processed this webhook, return success to acknowledge
		return json({ received: true, duplicate: true });
	}

	// Find the job by ERMS job_id (which we sent to AudioKit)
	const [job] = await db
		.select({ id: audiokitJobs.id, providerJobId: audiokitJobs.providerJobId })
		.from(audiokitJobs)
		.where(eq(audiokitJobs.id, ermsJobId))
		.for('update');

	if (!job) {
		// Job not found - this could be a duplicate webhook or wrong job_id
		return text('Job not found', { status: 404 });
	}

	// Verify provider_job_id matches (basic safety check)
	if (job.providerJobId !== provider_job_id) {
		throw error(400, 'provider_job_id mismatch');
	}

	// Record the event_id to prevent duplicate processing
	await db.insert(webhookEvents).values({
		eventId: event_id,
		eventType,
		jobId: ermsJobId
	});

	// Update job status based on event type
	const now = new Date();
	switch (eventType) {
		case 'job.succeeded':
			await db
				.update(audiokitJobs)
				.set({
					status: 'succeeded',
					result: validEvent.data.result,
					provenance: provenance ?? null,
					finishedAt: now
				})
				.where(eq(audiokitJobs.id, ermsJobId));
			break;

		case 'job.failed':
			await db
				.update(audiokitJobs)
				.set({
					status: 'failed',
					error: validEvent.data.error,
					finishedAt: now
				})
				.where(eq(audiokitJobs.id, ermsJobId));
			break;

		case 'job.canceled':
			await db
				.update(audiokitJobs)
				.set({
					status: 'canceled',
					finishedAt: now
				})
				.where(eq(audiokitJobs.id, ermsJobId));
			break;
	}

	return json({ received: true });
};
