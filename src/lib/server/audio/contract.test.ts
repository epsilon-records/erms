import { describe, expect, it } from 'vitest';
import { JobRequestV1, SCHEMA_VERSION } from './contract';
import { WebhookRejected } from './provider';
import { StubProvider } from './stub';

const SECRET = 'whsec_test';
const FIXED = new Date('2026-10-31T10:00:00Z');

function request(jobId = 'erms-job-001'): JobRequestV1 {
	return JobRequestV1.parse({
		schema_version: SCHEMA_VERSION,
		job_id: jobId,
		source: { system: 'erms', track_id: 'track-123', asset_id: 'asset-789' },
		input: {
			uri: 'https://storage.example/signed/original.wav?sig=abc',
			sha256: 'a'.repeat(64),
			format: 'wav',
			sample_rate: 48000,
			channels: 2
		},
		output: { put_prefix: 'https://storage.example/signed/outputs/erms-job-001/' },
		operation: {
			type: 'stem_separation',
			parameters: { stems: ['vocals', 'drums', 'bass', 'other'] }
		},
		authorization: { decision_id: 'authz-1', purpose: 'audio_processing' },
		callback: { url: 'https://erms.example/api/webhooks/audiokit' }
	});
}

/**
 * Contract tests every AudioProvider must pass. Phase 4 runs the same suite
 * against the AudioKit adapter.
 */
describe('AudioProvider contract (stub)', () => {
	const provider = () => new StubProvider(SECRET, () => FIXED);

	it('acknowledges a job as queued', async () => {
		const ack = await provider().submit(request());
		expect(ack).toMatchObject({ job_id: 'erms-job-001', status: 'queued' });
		expect(ack.provider_job_id).toBeTruthy();
	});

	it('is idempotent on job_id', async () => {
		const p = provider();
		const a = await p.submit(request());
		const b = await p.submit(request());
		expect(b).toEqual(a);
	});

	it('rejects requests that break the contract', async () => {
		const bad = { ...request(), input: { ...request().input, sha256: 'not-a-hash' } };
		await expect(provider().submit(bad)).rejects.toThrow();
	});

	it('reports status and supports cancel', async () => {
		const p = provider();
		const { provider_job_id } = await p.submit(request());
		await p.cancel(provider_job_id);
		expect((await p.status(provider_job_id)).status).toBe('cancelled');
	});

	it('accepts its own signed webhook and rejects a forged one', async () => {
		const p = provider();
		const { provider_job_id } = await p.submit(request());
		const { body, signature } = p.completeJob(provider_job_id, [
			{
				asset_id: 'out-1',
				type: 'stem',
				name: 'vocals',
				uri: 'erms-assets/outputs/erms-job-001/vocals.wav',
				sha256: 'b'.repeat(64),
				format: 'wav'
			}
		]);

		const event = await p.verifyWebhook(body, signature);
		expect(event).toMatchObject({ job_id: 'erms-job-001', status: 'completed' });
		expect(event.outputs).toHaveLength(1);

		const forged = body.replace('vocals', 'drums');
		await expect(p.verifyWebhook(forged, signature)).rejects.toBeInstanceOf(WebhookRejected);
	});
});
