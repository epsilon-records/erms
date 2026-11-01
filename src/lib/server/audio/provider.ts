import type { Capability, JobAck, JobRequestV1, JobStatus, WebhookEventV1 } from './contract';

/**
 * ERMS talks to audio processing only through this interface.
 * AudioKit is the first real implementation (Phase 3); the stub is the second, for tests.
 */
export interface AudioProvider {
	readonly name: string;
	capabilities(): Promise<Capability[]>;
	/** Idempotent on request.job_id: resubmitting returns the original ack. */
	submit(request: JobRequestV1): Promise<JobAck>;
	status(providerJobId: string): Promise<JobStatus>;
	cancel(providerJobId: string): Promise<void>;
	/** Throws WebhookRejected if the signature, timestamp or body is invalid. */
	verifyWebhook(rawBody: string, signatureHeader: string | null): Promise<WebhookEventV1>;
}

export class WebhookRejected extends Error {
	constructor(readonly reason: string) {
		super(`webhook rejected: ${reason}`);
	}
}
