import { and, asc, desc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { ApiErrorCode, Job, Operation } from './audio/contract';
import { OPERATIONS, PARAMS_SCHEMAS } from './audio/contract';
import { AudioProviderError } from './audio/provider';
import type { providerResolver } from './audiokit-clients';
import { type Actor, type Database, recordSystemAudit, withAudit } from './audit';
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
		readonly status: 400 | 402 | 403 | 404 | 409 | 422,
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

// Derived from the contract so a newly supported operation cannot be forgotten here.
export const QueueJobRequest = z.object({
	operation: z.enum(Object.keys(OPERATIONS) as [Operation, ...Operation[]]),
	params: z.record(z.string(), z.unknown()).nullable().optional()
});

export type QueueJobResult = {
	jobId: string;
	status: 'queued';
	operation: Operation;
};

/** Role, request shape and params, checked before any database work. */
function parseQueueInput(ctx: JobsCtx, input: unknown) {
	assertCanSubmit(ctx);
	const parsed = QueueJobRequest.safeParse(input);
	if (!parsed.success) throw new JobError(400, 'Invalid job request.');
	const { operation, params } = parsed.data;

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
	return { operation, params: params ?? null };
}

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
	const { operation, params } = parseQueueInput(ctx, input);

	if (!UUID.test(recordingId) || !UUID.test(masterId)) {
		throw new JobError(404, 'Recording or master not found');
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
				params,
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

export const NO_READY_MASTER = 'Upload a ready master before running analysis.';

/**
 * The recording page's Run / Re-run (EPSILON-145): queue a job on the recording's newest ready
 * master and return. It never calls AudioKit or R2: the per-minute worker submits the job
 * (decision 0013), so the request costs only database round trips.
 *
 * Production reaches the database across the Atlantic (~100 ms a round trip, and two for each
 * parameterised statement), so the work is kept to one statement that picks the master and
 * writes the job, plus the audit row, in the caller's transaction. Run it under `locals.db`:
 * RLS checks the master read and the job insert as the signed-in member.
 */
export async function queueJobForLatestMaster(
	db: Database,
	ctx: JobsCtx,
	recordingId: string,
	input: unknown
): Promise<QueueJobResult> {
	const { operation, params } = parseQueueInput(ctx, input);
	// Any recording without a ready master answers the same, whether or not it exists.
	if (!UUID.test(recordingId)) throw new JobError(409, NO_READY_MASTER);

	return withAudit(db, ctx, async (tx, audit) => {
		const id = uuidv7();
		const rows = (await tx.execute(sql`
			insert into audiokit_jobs (id, org_id, recording_id, master_id, operation, params, requested_by)
			select ${id}::uuid, m.org_id, m.recording_id, m.id, ${operation}, ${
				params === null ? null : JSON.stringify(params)
			}::jsonb, ${ctx.actor.id}
			from masters m
			where m.org_id = ${ctx.orgId}::uuid and m.recording_id = ${recordingId}::uuid
				and m.status = 'ready'
			order by m.created_at desc
			limit 1
			returning id`)) as unknown as { id: string }[];
		if (rows.length === 0) throw new JobError(409, NO_READY_MASTER);

		await audit({
			entity: 'audiokit_job',
			entityId: id,
			action: 'queue',
			after: { operation, status: 'queued' }
		});
		return { jobId: id, status: 'queued' as const, operation };
	});
}

/**
 * Queued jobs the worker should try now: never tried, or last tried at least `retryDelayMs` ago.
 * Fewest attempts first, so jobs that keep failing (a label with no AudioKit client,
 * EPSILON-135) cannot fill every batch ahead of jobs that can run.
 */
export function dueQueuedJobs(db: Database, now: Date, retryDelayMs: number, limit: number) {
	const minRetryTime = new Date(now.getTime() - retryDelayMs);
	return db
		.select({ id: audiokitJobs.id, attempts: audiokitJobs.attempts, orgId: audiokitJobs.orgId })
		.from(audiokitJobs)
		.where(
			and(
				eq(audiokitJobs.status, 'queued'),
				or(isNull(audiokitJobs.lastAttemptAt), lte(audiokitJobs.lastAttemptAt, minRetryTime))
			)
		)
		.orderBy(asc(audiokitJobs.attempts), asc(audiokitJobs.requestedAt))
		.limit(limit);
}

/**
 * AudioKit's plan refusals (`402` from `POST /v1/jobs`), with the reason a label member sees on
 * the failed job. Nothing was queued, and the same request gets the same answer until the plan
 * changes, so the job fails at once instead of being retried. (`503 entitlement_unavailable`
 * is not here: the plan couldn't be checked, and a later try can succeed.)
 */
export const PLAN_REFUSALS: Partial<Record<ApiErrorCode, string>> = {
	job_allowance_exhausted:
		'AudioKit refused the job: the plan’s job allowance for this billing period is used up.',
	stem_allowance_exhausted:
		'AudioKit refused the job: the plan’s stem allowance for this billing period is used up.',
	no_active_plan: 'AudioKit refused the job: the AudioKit client has no active plan.'
};

export type SubmitOutcome = { status: 'submitted' } | { status: 'failed'; code: ApiErrorCode };

/**
 * Submit a queued job to AudioKit. Called by the background worker. Issues presigned URLs
 * for the master (input) and any outputs, then submits to AudioKit with the job_id as the
 * idempotency key. Stores the provider_job_id returned by AudioKit. A plan refusal
 * (`PLAN_REFUSALS`) marks the job failed and returns; any other error is thrown, and the
 * worker retries it.
 */
export async function submitQueuedJob(
	db: Database,
	storage: MasterStorage,
	providers: Pick<ReturnType<typeof providerResolver>, 'forSubmission' | 'forClient'>,
	jobId: string,
	webhookBase: string
): Promise<SubmitOutcome> {
	const [job] = await db
		.select({
			id: audiokitJobs.id,
			orgId: audiokitJobs.orgId,
			clientId: audiokitJobs.clientId,
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

	// The org comes from the job row, which was written from the signed-in member's membership; it
	// is never read from a request. A retry stays under the client the job was first tried with
	// (AudioKit's idempotency is per client), unless that client is gone.
	const stamped = job.clientId ? await providers.forClient(job.clientId) : null;
	const { provider: audiokit, clientId } = stamped
		? { provider: stamped, clientId: job.clientId }
		: await providers.forSubmission(job.orgId);
	if (clientId !== job.clientId) {
		await db.update(audiokitJobs).set({ clientId }).where(eq(audiokitJobs.id, job.id));
	}
	const webhookUrl = webhookUrlFor(webhookBase, clientId);

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
	let audiokitJob: Job;
	try {
		audiokitJob = await audiokit.submit({
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
	} catch (err) {
		const message =
			err instanceof AudioProviderError && Object.hasOwn(PLAN_REFUSALS, err.code)
				? PLAN_REFUSALS[err.code]
				: undefined;
		if (!message) throw err;
		const code = (err as AudioProviderError).code;
		const now = new Date();
		// Machine write: the terminal status change and its audit row together (decision 0014).
		await db.transaction(async (tx) => {
			await tx
				.update(audiokitJobs)
				.set({
					status: 'failed',
					error: { code, message },
					finishedAt: now,
					attempts: job.attempts + 1,
					lastAttemptAt: now
				})
				.where(eq(audiokitJobs.id, job.id));
			await recordSystemAudit(tx, {
				orgId: job.orgId,
				entity: 'audiokit_job',
				entityId: job.id,
				action: 'refused',
				after: { status: 'failed', code }
			});
		});
		return { status: 'failed', code };
	}

	// Store provider_job_id and mark as submitted, with an audit entry (decision 0014).
	await db.transaction(async (tx) => {
		await tx
			.update(audiokitJobs)
			.set({
				providerJobId: audiokitJob.provider_job_id,
				status: 'submitted',
				submittedAt: new Date(),
				attempts: job.attempts + 1,
				lastAttemptAt: new Date()
			})
			.where(eq(audiokitJobs.id, job.id));
		await recordSystemAudit(tx, {
			orgId: job.orgId,
			entity: 'audiokit_job',
			entityId: job.id,
			action: 'submit',
			after: { status: 'submitted', provider_job_id: audiokitJob.provider_job_id }
		});
	});
	return { status: 'submitted' };
}

/**
 * Where AudioKit posts a job's webhook: a per-client URL for a label's own client, so the secret is
 * picked by the URL before the body is parsed; the original URL for the deployment-wide fallback.
 */
export function webhookUrlFor(base: string, clientId: string | null) {
	const url = new URL('/api/audiokit/webhook', base);
	if (clientId) url.pathname += `/${clientId}`;
	return url.toString();
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
	providers: Pick<ReturnType<typeof providerResolver>, 'forClient'>
): Promise<{ checked: number; updated: number }> {
	// Find jobs that are submitted but not finished, and were submitted >5 minutes ago.
	// Newer jobs still have time to receive their webhook without a poll (EPSILON-67).
	const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

	// No `.for('update')`: the lock would be released before the AudioKit call below,
	// and each job's terminal update is idempotent, so a plain read is enough.
	const jobs = await db
		.select({
			id: audiokitJobs.id,
			providerJobId: audiokitJobs.providerJobId,
			status: audiokitJobs.status,
			orgId: audiokitJobs.orgId,
			clientId: audiokitJobs.clientId
		})
		.from(audiokitJobs)
		.where(
			and(eq(audiokitJobs.status, 'submitted'), lte(audiokitJobs.submittedAt, fiveMinutesAgo))
		);

	let checked = 0;
	let updated = 0;

	for (const job of jobs) {
		if (!job.providerJobId) continue;

		try {
			// Poll with the key of the client the job was submitted under. A revoked client's key is
			// gone (and would answer 401), so its jobs are left alone rather than retried in a loop.
			const audiokit = await providers.forClient(job.clientId);
			if (!audiokit) continue;
			checked++;
			// Poll AudioKit for the current job status
			const audiokitJob = await audiokit.status(job.providerJobId);

			// If the job is finished, update our database
			if (
				audiokitJob.status === 'succeeded' ||
				audiokitJob.status === 'failed' ||
				audiokitJob.status === 'canceled'
			) {
				const now = new Date();
				// Narrowed here so it survives into the transaction closure.
				const status = audiokitJob.status;
				// Audit the machine write in the same transaction (decision 0014).
				await db.transaction(async (tx) => {
					await tx
						.update(audiokitJobs)
						.set({
							status,
							result: audiokitJob.result ?? null,
							error: audiokitJob.error ?? null,
							provenance: audiokitJob.provenance ?? null,
							finishedAt: now
						})
						.where(eq(audiokitJobs.id, job.id));
					await recordSystemAudit(tx, {
						orgId: job.orgId,
						entity: 'audiokit_job',
						entityId: job.id,
						action: 'reconcile',
						after: { status }
					});
				});

				updated++;
			}
		} catch (err) {
			// Log but don't fail the reconciliation for a single job
			console.error(`Failed to reconcile job ${job.id}:`, err);
		}
	}

	return { checked, updated };
}
