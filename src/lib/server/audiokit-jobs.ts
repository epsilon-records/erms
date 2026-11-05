import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Operation } from './audio/contract';
import { OPERATIONS, PARAMS_SCHEMAS } from './audio/contract';
import type { AudioProvider } from './audio/provider';
import { type Actor, type Database, withAudit } from './audit';
import { audiokitJobs, masters, recordings, type Role } from './db/schema';
import { uuidv7 } from './db/uuidv7';
import { hasScope } from './rbac';
import type { MasterStorage } from './storage/r2';

/**
 * AudioKit job submission (EPSILON-30). Users queue analysis jobs for a recording's master;
 * a background worker picks up queued jobs, issues R2 presigned URLs, submits to AudioKit,
 * and stores the provider_job_id. Webhooks from AudioKit update job status.
 */

export type JobsCtx = { orgId: string; role: Role; actor: Actor };

export class JobError extends Error {
	constructor(
		readonly status: 400 | 403 | 404 | 409 | 422,
		message: string
	) {
		super(message);
	}
}

export function canSubmitJobs(role: Role) {
	return hasScope(role, 'catalog:write');
}

function assertCanSubmit(ctx: JobsCtx) {
	if (!canSubmitJobs(ctx.role)) {
		throw new JobError(403, `Your role (${ctx.role}) cannot submit AudioKit jobs.`);
	}
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const QueueJobRequest = z.object({
	operation: z.enum([
		'probe',
		'loudness',
		'waveform',
		'transcode',
		'preview',
		'tempo',
		'key',
		'fingerprint',
		'analyze',
		'tags'
	]),
	params: z.record(z.string(), z.unknown()).nullable().optional()
});

export type QueueJobResult = {
	jobId: string;
	status: 'queued';
	operation: Operation;
};

/**
 * Queue an AudioKit job for a recording's master. The background worker will submit it to
 * AudioKit with presigned URLs.
 */
export async function queueAudioKitJob(
	db: Database,
	ctx: JobsCtx,
	recordingId: string,
	masterId: string,
	input: unknown
): Promise<QueueJobResult> {
	assertCanSubmit(ctx);
	const parsed = QueueJobRequest.safeParse(input);
	if (!parsed.success) throw new JobError(400, 'Invalid job request.');
	const { operation, params } = parsed.data;

	if (!UUID.test(recordingId) || !UUID.test(masterId)) {
		throw new JobError(404, 'Recording or master not found');
	}

	// Validate params against the operation's schema
	const opDef = OPERATIONS[operation];
	if (params == null) {
		if (opDef.paramsRequired) throw new JobError(400, `${operation} requires params`);
	} else {
		const schema = PARAMS_SCHEMAS[opDef.params];
		const validated = schema.safeParse(params);
		if (!validated.success) {
			throw new JobError(
				400,
				`Invalid params: ${validated.error.issues.map((i) => i.message).join(', ')}`
			);
		}
	}

	return withAudit(db, ctx, async (tx, audit) => {
		// Check recording exists in this org
		const [rec] = await tx
			.select({ id: recordings.id })
			.from(recordings)
			.where(and(eq(recordings.orgId, ctx.orgId), eq(recordings.id, recordingId)));
		if (!rec) throw new JobError(404, 'Recording not found');

		// Check master exists for this recording and is ready
		const [master] = await tx
			.select({ id: masters.id, status: masters.status, recordingId: masters.recordingId })
			.from(masters)
			.where(and(eq(masters.id, masterId), eq(masters.recordingId, recordingId)));
		if (!master) throw new JobError(404, 'Master not found');
		if (master.status !== 'ready') {
			throw new JobError(409, `Master is ${master.status}, not ready for processing`);
		}

		// Create queued job
		const id = uuidv7();
		const [row] = await tx
			.insert(audiokitJobs)
			.values({
				id,
				orgId: ctx.orgId,
				recordingId,
				masterId,
				operation,
				params: params ?? null,
				status: 'queued',
				requestedBy: ctx.actor.id
			})
			.returning();

		await audit({
			entity: 'audiokit_job',
			entityId: id,
			action: 'queue',
			after: { operation, status: 'queued' }
		});

		return {
			jobId: id,
			status: 'queued' as const,
			operation
		};
	});
}

/**
 * Submit a queued job to AudioKit. Called by the background worker. Issues presigned URLs
 * for the master (input) and any outputs, then submits to AudioKit with the job_id as the
 * idempotency key. Stores the provider_job_id returned by AudioKit.
 */
export async function submitQueuedJob(
	db: Database,
	storage: MasterStorage,
	audiokit: AudioProvider,
	jobId: string,
	webhookUrl: string
): Promise<void> {
	const [job] = await db
		.select({
			id: audiokitJobs.id,
			orgId: audiokitJobs.orgId,
			recordingId: audiokitJobs.recordingId,
			masterId: audiokitJobs.masterId,
			operation: audiokitJobs.operation,
			params: audiokitJobs.params,
			status: audiokitJobs.status,
			attempts: audiokitJobs.attempts,
			masterKey: masters.objectKey,
			masterSha256: masters.sha256,
			masterFileName: masters.fileName
		})
		.from(audiokitJobs)
		.innerJoin(masters, eq(audiokitJobs.masterId, masters.id))
		.where(eq(audiokitJobs.id, jobId))
		.for('update');

	if (!job) throw new Error(`Job ${jobId} not found`);
	if (job.status !== 'queued') throw new Error(`Job ${jobId} is ${job.status}, not queued`);
	if (!job.masterSha256) throw new Error(`Master ${job.masterId} has no sha256`);

	const operation = job.operation as Operation;
	const opDef = OPERATIONS[operation];

	// Issue presigned GET URL for the master (valid for 1 hour)
	const inputUrl = await storage.presignGet(job.masterKey, 3600);

	// Issue presigned PUT URLs for outputs (if any)
	const outputsMap: Record<string, { url: string }> = {};
	for (const outputName of opDef.outputs) {
		// Outputs go in R2 under orgs/{orgId}/recordings/{recordingId}/audiokit/{jobId}/{outputName}
		const outputKey = `orgs/${job.orgId}/recordings/${job.recordingId}/audiokit/${job.id}/${outputName}`;
		outputsMap[outputName] = {
			url: await storage.presignPut(outputKey, 3600)
		};
	}

	// Submit to AudioKit
	const audiokitJob = await audiokit.submit({
		job_id: job.id,
		operation,
		input: {
			url: inputUrl,
			sha256: job.masterSha256,
			filename: job.masterFileName
		},
		params: job.params as Record<string, unknown> | null | undefined,
		outputs: Object.keys(outputsMap).length > 0 ? outputsMap : undefined,
		webhook: { url: webhookUrl }
	});

	// Store provider_job_id and mark as submitted
	await db
		.update(audiokitJobs)
		.set({
			providerJobId: audiokitJob.provider_job_id,
			status: 'submitted',
			submittedAt: new Date(),
			attempts: job.attempts + 1,
			lastAttemptAt: new Date()
		})
		.where(eq(audiokitJobs.id, job.id));
}

/**
 * List jobs for a recording, newest first.
 */
export function listJobs(db: Database, orgId: string, recordingId: string) {
	return db
		.select({
			id: audiokitJobs.id,
			operation: audiokitJobs.operation,
			status: audiokitJobs.status,
			providerJobId: audiokitJobs.providerJobId,
			requestedAt: audiokitJobs.requestedAt,
			submittedAt: audiokitJobs.submittedAt,
			finishedAt: audiokitJobs.finishedAt,
			result: audiokitJobs.result,
			error: audiokitJobs.error
		})
		.from(audiokitJobs)
		.where(and(eq(audiokitJobs.orgId, orgId), eq(audiokitJobs.recordingId, recordingId)))
		.orderBy(desc(audiokitJobs.requestedAt));
}

/**
 * Reconciliation: poll AudioKit for jobs that have been submitted but haven't finished.
 * Called periodically to catch missed webhooks. Polls jobs that have been submitted for more
 * than 5 minutes without a webhook.
 */
export async function reconcileJobs(
	db: Database,
	audiokit: AudioProvider
): Promise<{ checked: number; updated: number }> {
	// Find jobs that are submitted but not finished, and were submitted >5 minutes ago
	const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

	const jobs = await db
		.select({
			id: audiokitJobs.id,
			providerJobId: audiokitJobs.providerJobId,
			status: audiokitJobs.status
		})
		.from(audiokitJobs)
		.where(eq(audiokitJobs.status, 'submitted'))
		.for('update');

	let checked = 0;
	let updated = 0;

	for (const job of jobs) {
		if (!job.providerJobId) continue;

		checked++;

		try {
			// Poll AudioKit for the current job status
			const audiokitJob = await audiokit.status(job.providerJobId);

			// If the job is finished, update our database
			if (
				audiokitJob.status === 'succeeded' ||
				audiokitJob.status === 'failed' ||
				audiokitJob.status === 'canceled'
			) {
				const now = new Date();
				await db
					.update(audiokitJobs)
					.set({
						status: audiokitJob.status,
						result: audiokitJob.result ?? null,
						error: audiokitJob.error ?? null,
						provenance: audiokitJob.provenance ?? null,
						finishedAt: now
					})
					.where(eq(audiokitJobs.id, job.id));

				updated++;
			}
		} catch (err) {
			// Log but don't fail the reconciliation for a single job
			console.error(`Failed to reconcile job ${job.id}:`, err);
		}
	}

	return { checked, updated };
}
