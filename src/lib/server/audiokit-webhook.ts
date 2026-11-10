import { eq } from 'drizzle-orm';
import { WebhookEvent } from './audio/contract';
import { SIGNATURE_HEADER, verify } from './audio/webhook';
import { recordSystemAudit, type Database } from './audit';
import { audiokitJobs, webhookEvents } from './db/schema';

/**
 * Applies one AudioKit job webhook. The routes decide which secret verifies it (the one picked by
 * the client id in the URL, or the deployment-wide fallback) and hand it in with the scope the
 * event is allowed to touch, so this code never reads a secret from anywhere else:
 *  - `label`: only jobs of that client's org that were submitted under that client;
 *  - `fallback`: only jobs that were not submitted under a label client.
 * A job outside the scope answers 404, the same as a job that does not exist.
 */

export type WebhookScope =
	{ kind: 'label'; clientId: string; orgId: string } | { kind: 'fallback' };

export type WebhookOutcome =
	| { status: 200; body: { received: true; duplicate?: true } }
	| { status: 400 | 404; message: string };

export { SIGNATURE_HEADER };

class Rejected {
	constructor(readonly outcome: WebhookOutcome) {}
}

export async function applyWebhook(
	db: Database,
	input: { rawBody: string; signature: string | null; secret: string; scope: WebhookScope }
): Promise<WebhookOutcome> {
	const result = verify(input.secret, input.rawBody, input.signature);
	if (!result.ok) return { status: 400, message: `Webhook rejected: ${result.reason}` };

	let json: unknown;
	try {
		json = JSON.parse(input.rawBody);
	} catch {
		return { status: 400, message: 'Webhook rejected: invalid_json' };
	}
	const parsed = WebhookEvent.safeParse(json);
	if (!parsed.success) return { status: 400, message: 'Invalid webhook event structure' };

	const validEvent = parsed.data;
	const { event_id, type: eventType } = validEvent;
	const { job_id: ermsJobId, provider_job_id, provenance, finished_at } = validEvent.data;
	// AudioKit's own finish time, not ERMS's receive time (EPSILON-71).
	const finishedAt = finished_at ? new Date(finished_at) : new Date();

	// The duplicate check, the job lookup and the update run in one transaction. The
	// `.for('update')` lock only holds inside a transaction, and a failure must not
	// leave the event_id recorded with the job un-updated: AudioKit would retry, hit
	// the duplicate check, and the result would be lost (EPSILON-66).
	try {
		return await db.transaction(async (tx): Promise<WebhookOutcome> => {
			const [existingEvent] = await tx
				.select({ eventId: webhookEvents.eventId })
				.from(webhookEvents)
				.where(eq(webhookEvents.eventId, event_id));
			if (existingEvent) return { status: 200, body: { received: true, duplicate: true } };

			const [job] = await tx
				.select({
					id: audiokitJobs.id,
					providerJobId: audiokitJobs.providerJobId,
					orgId: audiokitJobs.orgId,
					clientId: audiokitJobs.clientId
				})
				.from(audiokitJobs)
				.where(eq(audiokitJobs.id, ermsJobId))
				.for('update');

			const inScope =
				job &&
				(input.scope.kind === 'label'
					? job.orgId === input.scope.orgId && job.clientId === input.scope.clientId
					: job.clientId === null);
			if (!job || !inScope) throw new Rejected({ status: 404, message: 'Job not found' });

			if (job.providerJobId !== provider_job_id) {
				throw new Rejected({ status: 400, message: 'provider_job_id mismatch' });
			}

			await tx.insert(webhookEvents).values({ eventId: event_id, eventType, jobId: ermsJobId });

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
						.set({ status: 'failed', error: validEvent.data.error, finishedAt })
						.where(eq(audiokitJobs.id, ermsJobId));
					break;
				case 'job.canceled':
					await tx
						.update(audiokitJobs)
						.set({ status: 'canceled', finishedAt })
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
			return { status: 200, body: { received: true } };
		});
	} catch (err) {
		if (err instanceof Rejected) return err.outcome;
		throw err;
	}
}
