import { randomUUID } from 'node:crypto';
import {
	Capability,
	JobAck,
	JobRequestV1,
	JobStatus,
	SCHEMA_VERSION,
	WebhookEventV1
} from './contract';
import { type AudioProvider, WebhookRejected } from './provider';
import { sign, verify } from './webhook';

type StoredJob = { request: JobRequestV1; ack: JobAck; status: JobStatus };

/**
 * In-memory provider that honours the full contract: idempotent submit, status,
 * cancel, and signed webhooks. Used by tests and local development.
 */
export class StubProvider implements AudioProvider {
	readonly name = 'stub';
	private jobs = new Map<string, StoredJob>();
	private byProviderId = new Map<string, string>();

	constructor(
		private readonly webhookSecret: string,
		private readonly now: () => Date = () => new Date()
	) {}

	async capabilities(): Promise<Capability[]> {
		return [
			{ operation: 'analyze', async: true, requires_consent: false },
			{ operation: 'stem_separation', async: true, requires_consent: false }
		].map((c) => Capability.parse(c));
	}

	async submit(request: JobRequestV1): Promise<JobAck> {
		const req = JobRequestV1.parse(request);
		const existing = this.jobs.get(req.job_id);
		if (existing) return existing.ack;

		const providerJobId = `stub-${randomUUID()}`;
		const ack = JobAck.parse({
			job_id: req.job_id,
			provider_job_id: providerJobId,
			status: 'queued',
			created_at: this.now().toISOString()
		});
		this.jobs.set(req.job_id, {
			request: req,
			ack,
			status: { provider_job_id: providerJobId, status: 'queued' }
		});
		this.byProviderId.set(providerJobId, req.job_id);
		return ack;
	}

	async status(providerJobId: string): Promise<JobStatus> {
		return JobStatus.parse(this.get(providerJobId).status);
	}

	async cancel(providerJobId: string): Promise<void> {
		const job = this.get(providerJobId);
		if (job.status.status === 'queued' || job.status.status === 'processing') {
			job.status = { ...job.status, status: 'cancelled' };
		}
	}

	async verifyWebhook(rawBody: string, signatureHeader: string | null): Promise<WebhookEventV1> {
		const nowSeconds = Math.floor(this.now().getTime() / 1000);
		const result = verify(this.webhookSecret, rawBody, signatureHeader, nowSeconds);
		if (!result.ok) throw new WebhookRejected(result.reason);
		const parsed = WebhookEventV1.safeParse(JSON.parse(rawBody));
		if (!parsed.success) throw new WebhookRejected('invalid_body');
		return parsed.data;
	}

	/** Test helper: complete a job and produce the signed webhook AudioKit would send. */
	completeJob(providerJobId: string, outputs: WebhookEventV1['outputs'] = []) {
		const job = this.get(providerJobId);
		job.status = { provider_job_id: providerJobId, status: 'completed' };
		const event = WebhookEventV1.parse({
			schema_version: SCHEMA_VERSION,
			event_id: `evt-${randomUUID()}`,
			job_id: job.request.job_id,
			provider_job_id: providerJobId,
			status: 'completed',
			source: { track_id: job.request.source.track_id, asset_id: job.request.source.asset_id },
			outputs,
			engine: { name: 'stub', version: '0.0.0' }
		});
		const body = JSON.stringify(event);
		const t = Math.floor(this.now().getTime() / 1000);
		return { body, signature: sign(this.webhookSecret, body, t) };
	}

	private get(providerJobId: string): StoredJob {
		const jobId = this.byProviderId.get(providerJobId);
		const job = jobId ? this.jobs.get(jobId) : undefined;
		if (!job) throw new Error(`unknown provider job ${providerJobId}`);
		return job;
	}
}
