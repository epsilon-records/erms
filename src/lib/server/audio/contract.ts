import { z } from 'zod';

/**
 * ERMS <-> audio provider integration contract, v1.0.
 * Shapes follow the ChatGPT draft §6.2-6.4 with the spec's three changes:
 * separate provider job IDs, authorization by decision reference, and webhook event IDs.
 */

export const SCHEMA_VERSION = '1.0';

const sha256 = z.string().regex(/^[0-9a-f]{64}$/, 'lowercase hex sha256');

export const OperationType = z.enum([
	'analyze',
	'stem_separation',
	'master',
	'clean',
	'transcribe',
	// Gated behind explicit consent (Phase 7); listed so the contract is stable.
	'voice_synthesis',
	'generate'
]);
export type OperationType = z.infer<typeof OperationType>;

export const JobStatusValue = z.enum([
	'queued',
	'validating',
	'processing',
	'completed',
	'failed',
	'cancelled'
]);
export type JobStatusValue = z.infer<typeof JobStatusValue>;

export const JobRequestV1 = z.object({
	schema_version: z.literal(SCHEMA_VERSION),
	/** ERMS job id; also the idempotency key. */
	job_id: z.string().min(1),
	source: z.object({
		system: z.literal('erms'),
		track_id: z.string().min(1),
		release_id: z.string().min(1).optional(),
		asset_id: z.string().min(1)
	}),
	input: z.object({
		/** Short-lived signed GET URL. Never logged. */
		uri: z.url(),
		sha256,
		format: z.string().min(1),
		sample_rate: z.number().int().positive(),
		channels: z.number().int().positive()
	}),
	/** Signed PUT prefix in ERMS storage where outputs are written. */
	output: z.object({ put_prefix: z.url() }),
	operation: z.object({
		type: OperationType,
		parameters: z.record(z.string(), z.unknown()).default({})
	}),
	authorization: z.object({
		/** Points to an ERMS authorization_decisions row. No consent documents leave ERMS. */
		decision_id: z.string().min(1),
		purpose: z.string().min(1)
	}),
	callback: z.object({ url: z.url() })
});
export type JobRequestV1 = z.infer<typeof JobRequestV1>;

export const JobAck = z.object({
	job_id: z.string(),
	provider_job_id: z.string(),
	status: JobStatusValue,
	created_at: z.iso.datetime()
});
export type JobAck = z.infer<typeof JobAck>;

export const JobStatus = z.object({
	provider_job_id: z.string(),
	status: JobStatusValue,
	error: z.string().optional()
});
export type JobStatus = z.infer<typeof JobStatus>;

const Confidence = z.number().min(0).max(1);

export const OutputAsset = z.object({
	asset_id: z.string(),
	type: z.enum(['stem', 'processed_master', 'report']),
	name: z.string(),
	uri: z.string().min(1),
	sha256,
	format: z.string()
});
export type OutputAsset = z.infer<typeof OutputAsset>;

export const WebhookEventV1 = z.object({
	schema_version: z.literal(SCHEMA_VERSION),
	/** Unique per delivery attempt group; ERMS de-duplicates on it. */
	event_id: z.string().min(1),
	job_id: z.string(),
	provider_job_id: z.string(),
	status: JobStatusValue,
	source: z.object({ track_id: z.string(), asset_id: z.string() }),
	outputs: z.array(OutputAsset).default([]),
	analysis: z
		.object({
			bpm: z.object({ value: z.number(), confidence: Confidence }).optional(),
			key: z.object({ value: z.string(), confidence: Confidence }).optional(),
			genre: z.array(z.object({ value: z.string(), confidence: Confidence })).optional(),
			loudness_lufs: z.object({ value: z.number() }).optional()
		})
		.optional(),
	engine: z.object({ name: z.string(), version: z.string(), model_version: z.string().optional() }),
	error: z.string().optional()
});
export type WebhookEventV1 = z.infer<typeof WebhookEventV1>;

export const Capability = z.object({
	operation: OperationType,
	async: z.boolean(),
	requires_consent: z.boolean()
});
export type Capability = z.infer<typeof Capability>;
