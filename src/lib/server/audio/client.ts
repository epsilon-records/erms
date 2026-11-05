import type { ApiError, ApiErrorCode, Capability, Job, JobRequest, WebhookEvent } from './contract';
import { AudioProviderError, type AudioProvider, WebhookRejected } from './provider';
import * as webhook from './webhook';

/**
 * AudioKit HTTP client: the production AudioProvider implementation. Talks to the live
 * AudioKit API at the given base URL, using the API key for authentication and the webhook
 * secret to verify incoming webhooks.
 */
export class AudioKitClient implements AudioProvider {
	readonly name = 'AudioKit';

	constructor(
		private readonly baseUrl: string,
		private readonly apiKey: string,
		private readonly webhookSecret: string,
		private readonly fetchImpl: typeof fetch = fetch
	) {
		if (!this.baseUrl || !this.apiKey || !this.webhookSecret) {
			throw new Error('AudioKit client requires baseUrl, apiKey, and webhookSecret');
		}
	}

	private async request<T>(
		method: string,
		path: string,
		body?: unknown
	): Promise<{ data: T; status: number }> {
		const url = `${this.baseUrl}${path}`;
		const headers: Record<string, string> = {
			Authorization: `Bearer ${this.apiKey}`,
			'Content-Type': 'application/json'
		};

		const res = await this.fetchImpl(url, {
			method,
			headers,
			body: body ? JSON.stringify(body) : undefined
		});

		const text = await res.text();
		let data: unknown;
		try {
			data = text ? JSON.parse(text) : null;
		} catch {
			throw new AudioProviderError('internal', `Invalid JSON response from AudioKit: ${text}`);
		}

		if (!res.ok) {
			const error = data as ApiError | null;
			const code = (error?.error?.code ?? 'internal') as ApiErrorCode;
			const message = error?.error?.message ?? `AudioKit returned ${res.status}`;
			throw new AudioProviderError(code, message);
		}

		return { data: data as T, status: res.status };
	}

	async capabilities(): Promise<Capability[]> {
		const { data } = await this.request<{ operations: Capability[] }>('GET', '/v1/capabilities');
		return data.operations;
	}

	async submit(request: JobRequest): Promise<Job> {
		const { data } = await this.request<Job>('POST', '/v1/jobs', request);
		return data;
	}

	async status(providerJobId: string): Promise<Job> {
		const { data } = await this.request<Job>('GET', `/v1/jobs/${providerJobId}`);
		return data;
	}

	async cancel(providerJobId: string): Promise<Job> {
		const { data } = await this.request<Job>('POST', `/v1/jobs/${providerJobId}/cancel`);
		return data;
	}

	async verifyWebhook(rawBody: string, signatureHeader: string | null): Promise<WebhookEvent> {
		const result = webhook.verify(this.webhookSecret, rawBody, signatureHeader);
		if (!result.ok) {
			throw new WebhookRejected(result.reason);
		}

		let event: unknown;
		try {
			event = JSON.parse(rawBody);
		} catch {
			throw new WebhookRejected('invalid_json');
		}

		// Basic validation - the full schema is checked by the caller
		if (
			!event ||
			typeof event !== 'object' ||
			!('event_id' in event) ||
			!('type' in event) ||
			!('data' in event)
		) {
			throw new WebhookRejected('invalid_event_structure');
		}

		return event as WebhookEvent;
	}
}

/**
 * Creates an AudioKit client from environment variables. Returns null if AudioKit
 * isn't configured (base URL or API key missing).
 */
export function createAudioKitClient(
	baseUrl: string | undefined,
	apiKey: string | undefined,
	webhookSecret: string | undefined
): AudioKitClient | null {
	if (!baseUrl || !apiKey || !webhookSecret) {
		return null;
	}
	return new AudioKitClient(baseUrl, apiKey, webhookSecret);
}
