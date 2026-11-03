import type { ApiErrorCode, Capability, Job, JobRequest, WebhookEvent } from './contract';

/**
 * ERMS talks to audio processing only through this interface, in the shapes of AudioKit's
 * OpenAPI contract. AudioKit is the real implementation; the stub is for tests.
 */
export interface AudioProvider {
	readonly name: string;
	/** `GET /v1/capabilities`: the operations this instance can run. */
	capabilities(): Promise<Capability[]>;
	/**
	 * `POST /v1/jobs`. Idempotent on `request.job_id`: the same request returns the same job;
	 * the same `job_id` with a different request throws `AudioProviderError('idempotency_conflict')`.
	 */
	submit(request: JobRequest): Promise<Job>;
	/** `GET /v1/jobs/{provider_job_id}`. Always has the final state. */
	status(providerJobId: string): Promise<Job>;
	/** `POST /v1/jobs/{provider_job_id}/cancel`. A running job may report `running` until it stops. */
	cancel(providerJobId: string): Promise<Job>;
	/** Throws WebhookRejected if the signature, timestamp or body is invalid. */
	verifyWebhook(rawBody: string, signatureHeader: string | null): Promise<WebhookEvent>;
}

/** An error response (`{"error": {"code", "message"}}`) from the provider. */
export class AudioProviderError extends Error {
	constructor(
		readonly code: ApiErrorCode,
		message: string = code
	) {
		super(message);
	}
}

export class WebhookRejected extends Error {
	constructor(readonly reason: string) {
		super(`webhook rejected: ${reason}`);
	}
}
