import { isDeepStrictEqual } from 'node:util';
import { randomUUID } from 'node:crypto';
import {
	Capability,
	Job,
	JobRequest,
	OPERATIONS,
	type JobError,
	type Operation,
	type ResultFor,
	WebhookEvent
} from './contract';
import { type AudioProvider, AudioProviderError, WebhookRejected } from './provider';
import { sign, verify } from './webhook';

type StoredJob = { request: JobRequest; job: Job };

/**
 * In-memory provider that speaks AudioKit's contract: idempotent submit with conflicts,
 * status, cancel, and signed webhooks. Used by tests and local development.
 */
export class StubProvider implements AudioProvider {
	readonly name = 'stub';
	readonly version = '0.0.0-stub';
	private jobs = new Map<string, StoredJob>();
	private byProviderId = new Map<string, string>();

	constructor(
		private readonly webhookSecret: string,
		private readonly now: () => Date = () => new Date()
	) {}

	async capabilities(): Promise<Capability[]> {
		return (Object.keys(OPERATIONS) as Operation[]).map((operation) =>
			Capability.parse({
				operation,
				outputs: [...OPERATIONS[operation].outputs],
				async: true,
				requires_consent: false
			})
		);
	}

	async submit(request: JobRequest): Promise<Job> {
		const parsed = JobRequest.safeParse(request);
		if (!parsed.success) throw new AudioProviderError('invalid_request', parsed.error.message);
		const req = parsed.data;

		const existing = this.jobs.get(req.job_id);
		if (existing) {
			if (!isDeepStrictEqual(existing.request, req)) {
				throw new AudioProviderError('idempotency_conflict');
			}
			return existing.job;
		}

		const job = Job.parse({
			provider_job_id: randomUUID(),
			job_id: req.job_id,
			operation: req.operation,
			status: 'queued',
			created_at: this.now().toISOString()
		});
		this.jobs.set(req.job_id, { request: req, job });
		this.byProviderId.set(job.provider_job_id, req.job_id);
		return job;
	}

	async status(providerJobId: string): Promise<Job> {
		return this.get(providerJobId).job;
	}

	async cancel(providerJobId: string): Promise<Job> {
		const stored = this.get(providerJobId);
		if (stored.job.status === 'queued' || stored.job.status === 'running') {
			this.finish(stored, { status: 'canceled' });
		}
		return stored.job;
	}

	async verifyWebhook(rawBody: string, signatureHeader: string | null): Promise<WebhookEvent> {
		const nowSeconds = Math.floor(this.now().getTime() / 1000);
		const result = verify(this.webhookSecret, rawBody, signatureHeader, nowSeconds);
		if (!result.ok) throw new WebhookRejected(result.reason);
		let body: unknown;
		try {
			body = JSON.parse(rawBody);
		} catch {
			throw new WebhookRejected('invalid_body');
		}
		const parsed = WebhookEvent.safeParse(body);
		if (!parsed.success) throw new WebhookRejected('invalid_body');
		return parsed.data;
	}

	/** Test helper: start a queued job. */
	startJob(providerJobId: string): Job {
		const stored = this.get(providerJobId);
		stored.job = Job.parse({
			...stored.job,
			status: 'running',
			started_at: this.now().toISOString()
		});
		return stored.job;
	}

	/** Test helper: succeed a job and produce the signed webhook AudioKit would send. */
	completeJob<O extends Operation>(providerJobId: string, result: ResultFor<O>) {
		const stored = this.get(providerJobId);
		this.finish(stored, {
			status: 'succeeded',
			result,
			provenance: {
				input_sha256: stored.request.input.sha256.toLowerCase(),
				audiokit_version: this.version,
				operation: stored.request.operation,
				params: stored.request.params ?? {}
			}
		});
		return this.webhookFor(stored.job);
	}

	/** Test helper: fail a job and produce the signed webhook. */
	failJob(providerJobId: string, error: JobError) {
		const stored = this.get(providerJobId);
		this.finish(stored, { status: 'failed', error });
		return this.webhookFor(stored.job);
	}

	/** The signed webhook for a finished job: `{ body, signature }` for `X-Signature`. */
	webhookFor(job: Job) {
		const event = WebhookEvent.parse({
			event_id: randomUUID(),
			type: `job.${job.status}`,
			created_at: this.now().toISOString(),
			data: job
		});
		const body = JSON.stringify(event);
		const t = Math.floor(this.now().getTime() / 1000);
		return { event, body, signature: sign(this.webhookSecret, body, t) };
	}

	private finish(stored: StoredJob, fields: Partial<Job>) {
		const now = this.now().toISOString();
		stored.job = Job.parse({
			...stored.job,
			// A job canceled while queued never started.
			started_at: stored.job.started_at ?? (fields.status === 'canceled' ? undefined : now),
			finished_at: now,
			...fields
		});
	}

	private get(providerJobId: string): StoredJob {
		const jobId = this.byProviderId.get(providerJobId);
		const stored = jobId ? this.jobs.get(jobId) : undefined;
		if (!stored) throw new AudioProviderError('not_found');
		return stored;
	}
}
