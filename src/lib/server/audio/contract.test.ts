import { describe, expect, it } from 'vitest';
import { JobRequest, WebhookEvent, type ResultFor } from './contract';
import { AudioProviderError, WebhookRejected } from './provider';
import { StubProvider } from './stub';

const SECRET = 'whsec_test';
const FIXED = new Date('2026-10-31T10:00:00Z');
const SHA = 'a'.repeat(64);

function loudness(jobId = 'erms-job-001'): JobRequest {
	return JobRequest.parse({
		job_id: jobId,
		operation: 'loudness',
		input: { url: 'https://storage.example/signed/original.wav?sig=abc', sha256: SHA },
		webhook: { url: 'https://erms.example/api/webhooks/audiokit' },
		authorization: { decision_id: 'authz-1', purpose: 'analysis' }
	});
}

const LOUDNESS: ResultFor<'loudness'> = {
	integrated_lufs: -9.12,
	loudness_range_lu: 5.4,
	true_peak_dbtp: -0.98,
	sample_peak_dbfs: -1.02,
	sample_rate: 48000,
	channels: 2,
	duration_seconds: 241.3
};

/**
 * Contract tests every AudioProvider must pass. The AudioKit adapter (EPSILON-30) runs the same
 * suite. Shapes are AudioKit's OpenAPI contract; `contract.drift.test.ts` checks them against it.
 */
describe('AudioProvider contract (stub)', () => {
	const provider = () => new StubProvider(SECRET, () => FIXED);

	it('lists capabilities with the outputs each operation needs', async () => {
		const caps = await provider().capabilities();
		expect(caps.find((c) => c.operation === 'preview')?.outputs).toEqual(['audio']);
		expect(caps.find((c) => c.operation === 'loudness')?.outputs).toEqual([]);
	});

	it('queues a job', async () => {
		const job = await provider().submit(loudness());
		expect(job).toMatchObject({ job_id: 'erms-job-001', operation: 'loudness', status: 'queued' });
		expect(job.provider_job_id).toMatch(/^[0-9a-f-]{36}$/);
	});

	it('is idempotent on job_id, and refuses the same job_id with a different request', async () => {
		const p = provider();
		const a = await p.submit(loudness());
		expect(await p.submit(loudness())).toEqual(a);
		const other = { ...loudness(), operation: 'probe' as const };
		await expect(p.submit(other)).rejects.toMatchObject({ code: 'idempotency_conflict' });
	});

	it('rejects requests that break the contract', async () => {
		const p = provider();
		const bad = (patch: Record<string, unknown>) => p.submit({ ...loudness(), ...patch });
		await expect(bad({ input: { url: 'https://x.example/a', sha256: 'nope' } })).rejects.toThrow(
			AudioProviderError
		);
		await expect(bad({ input: { url: 'http://x.example/a', sha256: SHA } })).rejects.toThrow();
		await expect(bad({ params: { points: 5 } })).rejects.toThrow(); // loudness takes no params
		await expect(bad({ job_id: 'has space' })).rejects.toThrow();
		await expect(bad({ operation: 'preview' })).rejects.toThrow(); // preview needs outputs.audio
		await expect(
			bad({ operation: 'transcode', params: { format: 'mp3', bit_depth: 24 } })
		).rejects.toThrow();
	});

	it('accepts a preview with an upload target', async () => {
		const job = await provider().submit({
			...loudness('erms-job-002'),
			operation: 'preview',
			params: { duration_seconds: 30 },
			outputs: { audio: { url: 'https://r2.example/put/preview.mp3?sig=x' } }
		});
		expect(job.status).toBe('queued');
	});

	it('reports status and cancels a queued job', async () => {
		const p = provider();
		const { provider_job_id } = await p.submit(loudness());
		const canceled = await p.cancel(provider_job_id);
		expect(canceled).toMatchObject({ status: 'canceled', finished_at: FIXED.toISOString() });
		expect(canceled.started_at).toBeUndefined();
		expect((await p.status(provider_job_id)).status).toBe('canceled');
		await expect(p.status('00000000-0000-4000-8000-000000000000')).rejects.toMatchObject({
			code: 'not_found'
		});
	});

	it('sends a signed job.succeeded webhook with result and provenance, and rejects a forged one', async () => {
		const p = provider();
		const { provider_job_id } = await p.submit(loudness());
		p.startJob(provider_job_id);
		const { body, signature } = p.completeJob<'loudness'>(provider_job_id, LOUDNESS);

		const event = await p.verifyWebhook(body, signature);
		expect(event.type).toBe('job.succeeded');
		expect(event.data).toMatchObject({
			job_id: 'erms-job-001',
			status: 'succeeded',
			result: LOUDNESS,
			provenance: { input_sha256: SHA, operation: 'loudness', params: {} }
		});

		const forged = body.replace('-9.12', '-6.12');
		await expect(p.verifyWebhook(forged, signature)).rejects.toBeInstanceOf(WebhookRejected);
	});

	it('sends a job.failed webhook with the error', async () => {
		const p = provider();
		const { provider_job_id } = await p.submit(loudness());
		const { body, signature } = p.failJob(provider_job_id, {
			code: 'input_hash_mismatch',
			message: 'downloaded bytes differ'
		});
		const event = await p.verifyWebhook(body, signature);
		expect(event).toMatchObject({
			type: 'job.failed',
			data: { error: { code: 'input_hash_mismatch' } }
		});
	});

	it('refuses a result that does not fit the operation', async () => {
		const p = provider();
		const { provider_job_id } = await p.submit(loudness());
		expect(() => p.completeJob(provider_job_id, { bpm: 120 } as never)).toThrow();
	});

	it('refuses an event whose type disagrees with the job status', () => {
		const job = {
			provider_job_id: '00000000-0000-4000-8000-000000000000',
			job_id: 'j',
			operation: 'probe',
			status: 'canceled',
			created_at: FIXED.toISOString(),
			finished_at: FIXED.toISOString()
		};
		const event = {
			event_id: '00000000-0000-4000-8000-000000000001',
			type: 'job.failed',
			created_at: FIXED.toISOString(),
			data: job
		};
		expect(WebhookEvent.safeParse(event).success).toBe(false);
		expect(WebhookEvent.safeParse({ ...event, type: 'job.canceled' }).success).toBe(true);
	});
});
