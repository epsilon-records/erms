import { z } from 'zod';

/**
 * ERMS's view of AudioKit's published contract (`openapi.yaml`, served at `GET /v1/openapi.yaml`).
 * Hand-written in Zod so requests and responses are validated at runtime; `contract.drift.test.ts`
 * checks every schema here against the OpenAPI document, so a change on either side fails CI.
 * Names match the OpenAPI component names.
 */

// --- Shared ---------------------------------------------------------------------------

export const Sha256 = z.string().regex(/^[0-9a-fA-F]{64}$/, 'hex sha256');
/** An https URL; AudioKit also requires it to resolve to a public address. */
export const HttpsUrl = z.url({ protocol: /^https$/ });

export const Operation = z.enum([
	'probe',
	'loudness',
	'waveform',
	'transcode',
	'preview',
	'normalize',
	'tempo',
	'key',
	'fingerprint',
	'analyze',
	'tags',
	'stems'
]);
export type Operation = z.infer<typeof Operation>;

export const OutputName = z.enum(['audio', 'vocals', 'drums', 'bass', 'other']);
export type OutputName = z.infer<typeof OutputName>;

export const JobStatus = z.enum(['queued', 'running', 'succeeded', 'failed', 'canceled']);
export type JobStatus = z.infer<typeof JobStatus>;

export const Format = z.enum(['wav', 'flac', 'mp3', 'aac']);
export type Format = z.infer<typeof Format>;

export const SampleRate = z.union([
	z.literal(22050),
	z.literal(24000),
	z.literal(32000),
	z.literal(44100),
	z.literal(48000),
	z.literal(96000)
]);

// --- Errors ---------------------------------------------------------------------------

/** Known codes. AudioKit may add more; treat an unknown code as `internal`. */
export const KNOWN_API_ERROR_CODES = [
	'invalid_request',
	'operation_unavailable',
	'unauthorized',
	'not_found',
	'client_not_found',
	'idempotency_conflict',
	'client_bootstrap',
	'rate_limited',
	'unavailable',
	'stem_allowance_exhausted',
	'job_allowance_exhausted',
	'no_active_plan',
	'entitlement_unavailable'
] as const;
export type ApiErrorCode = (typeof KNOWN_API_ERROR_CODES)[number] | (string & {});

export const KNOWN_JOB_ERROR_CODES = [
	'input_url_rejected',
	'input_unreachable',
	'input_too_large',
	'input_hash_mismatch',
	'unsupported_format',
	'unsupported_codec',
	'corrupt_input',
	'invalid_params',
	'operation_unavailable',
	'encode_failed',
	'output_url_rejected',
	'output_upload_failed',
	'stems_failed',
	'stems_unavailable',
	'timeout',
	'canceled',
	'internal'
] as const;
export type JobErrorCode = (typeof KNOWN_JOB_ERROR_CODES)[number] | (string & {});

export const ApiError = z.strictObject({
	error: z.strictObject({ code: z.string(), message: z.string() })
});
export type ApiError = z.infer<typeof ApiError>;

export const JobError = z.strictObject({ code: z.string(), message: z.string() });
export type JobError = z.infer<typeof JobError>;

// --- Service --------------------------------------------------------------------------

export const Health = z.strictObject({ status: z.literal('ok'), version: z.string() });
export type Health = z.infer<typeof Health>;

export const Capability = z.strictObject({
	operation: Operation,
	outputs: z.array(OutputName),
	async: z.boolean(),
	requires_consent: z.boolean()
});
export type Capability = z.infer<typeof Capability>;

export const Capabilities = z.strictObject({ operations: z.array(Capability) });
export type Capabilities = z.infer<typeof Capabilities>;

// --- Requests -------------------------------------------------------------------------

export const InputFile = z.object({
	/** Signed GET URL. Never logged. */
	url: HttpsUrl,
	sha256: Sha256,
	/** Original filename, used only as a format hint. */
	filename: z.string().optional()
});
export type InputFile = z.infer<typeof InputFile>;

/** A signed PUT URL, plus any headers its signature needs (not Content-Type/Length). */
export const OutputTarget = z.strictObject({
	url: HttpsUrl,
	headers: z.record(z.string(), z.string()).optional()
});
export type OutputTarget = z.infer<typeof OutputTarget>;

export const WebhookTarget = z.object({ url: HttpsUrl });
export type WebhookTarget = z.infer<typeof WebhookTarget>;

/** Points to an ERMS authorization decision. No consent documents leave ERMS. */
export const AuthorizationRef = z.object({
	decision_id: z.string(),
	purpose: z.string().optional()
});
export type AuthorizationRef = z.infer<typeof AuthorizationRef>;

export const NoParams = z.strictObject({});

export const WaveformParams = z.strictObject({
	points: z.int().min(10).max(10000).default(1000).optional()
});

export const TempoParams = z
	.strictObject({
		min_bpm: z.number().min(40).max(300).default(70).optional(),
		max_bpm: z.number().min(40).max(300).default(180).optional()
	})
	.refine((p) => (p.max_bpm ?? 180) >= (p.min_bpm ?? 70) + 10, {
		message: 'max_bpm must be at least 10 above min_bpm'
	});

export const TagsParams = z.strictObject({
	embedding: z.boolean().default(false).optional()
});

export const StemsModel = z.enum(['htdemucs_ft', 'htdemucs']);
export type StemsModel = z.infer<typeof StemsModel>;

export const StemsParams = z.strictObject({
	model: StemsModel.default('htdemucs_ft').optional()
});

export const TranscodeParams = z
	.strictObject({
		format: Format,
		sample_rate: SampleRate.optional(),
		channels: z.union([z.literal(1), z.literal(2)]).optional(),
		bit_depth: z
			.union([z.literal(16), z.literal(24)])
			.default(24)
			.optional(),
		bitrate_kbps: z.int().min(64).max(320).optional()
	})
	.superRefine((p, ctx) => {
		const lossy = p.format === 'mp3' || p.format === 'aac';
		if (lossy && p.bit_depth !== undefined)
			ctx.addIssue({ code: 'custom', message: 'bit_depth is for wav and flac only' });
		if (!lossy && p.bitrate_kbps !== undefined)
			ctx.addIssue({ code: 'custom', message: 'bitrate_kbps is for mp3 and aac only' });
		if (p.format === 'mp3' && (p.sample_rate ?? 0) > 48000)
			ctx.addIssue({ code: 'custom', message: 'mp3 goes up to 48000 Hz' });
	});

export const PreviewParams = z
	.strictObject({
		start_seconds: z.number().min(0).optional(),
		duration_seconds: z.number().min(5).max(120).default(30).optional(),
		fade_seconds: z.number().min(0).max(10).default(1).optional(),
		format: Format.default('mp3').optional(),
		bitrate_kbps: z.int().min(64).max(320).default(192).optional()
	})
	.superRefine((p, ctx) => {
		if ((p.format === 'wav' || p.format === 'flac') && p.bitrate_kbps !== undefined)
			ctx.addIssue({ code: 'custom', message: 'bitrate_kbps is for mp3 and aac only' });
	});

export const NormalizeParams = z
	.strictObject({
		target_lufs: z.number().min(-70).max(0),
		true_peak_dbtp: z.number().min(-20).max(0).default(-1).optional(),
		format: Format.default('flac').optional(),
		sample_rate: SampleRate.optional(),
		channels: z.union([z.literal(1), z.literal(2)]).optional(),
		bit_depth: z
			.union([z.literal(16), z.literal(24)])
			.default(24)
			.optional(),
		bitrate_kbps: z.int().min(64).max(320).optional()
	})
	.superRefine((p, ctx) => {
		const lossy = p.format === 'mp3' || p.format === 'aac';
		if (lossy && p.bit_depth !== undefined)
			ctx.addIssue({ code: 'custom', message: 'bit_depth is for wav and flac only' });
		if (!lossy && p.bitrate_kbps !== undefined)
			ctx.addIssue({ code: 'custom', message: 'bitrate_kbps is for mp3 and aac only' });
		if (p.format === 'mp3' && (p.sample_rate ?? 0) > 48000)
			ctx.addIssue({ code: 'custom', message: 'mp3 goes up to 48000 Hz' });
	});

/**
 * Per operation: its params schema (by OpenAPI component name), whether params are required,
 * and which outputs need upload targets. The drift test checks this table against the spec.
 */
export const OPERATIONS = {
	probe: { params: 'NoParams', paramsRequired: false, outputs: [] },
	loudness: { params: 'NoParams', paramsRequired: false, outputs: [] },
	waveform: { params: 'WaveformParams', paramsRequired: false, outputs: [] },
	transcode: { params: 'TranscodeParams', paramsRequired: true, outputs: ['audio'] },
	preview: { params: 'PreviewParams', paramsRequired: false, outputs: ['audio'] },
	normalize: { params: 'NormalizeParams', paramsRequired: true, outputs: ['audio'] },
	tempo: { params: 'TempoParams', paramsRequired: false, outputs: [] },
	key: { params: 'NoParams', paramsRequired: false, outputs: [] },
	fingerprint: { params: 'NoParams', paramsRequired: false, outputs: [] },
	analyze: { params: 'TempoParams', paramsRequired: false, outputs: [] },
	tags: { params: 'TagsParams', paramsRequired: false, outputs: [] },
	stems: {
		params: 'StemsParams',
		paramsRequired: false,
		outputs: ['vocals', 'drums', 'bass', 'other']
	}
} as const satisfies Record<
	Operation,
	{ params: ParamsSchemaName; paramsRequired: boolean; outputs: readonly OutputName[] }
>;

export const PARAMS_SCHEMAS = {
	NoParams,
	WaveformParams,
	TempoParams,
	TagsParams,
	TranscodeParams,
	PreviewParams,
	NormalizeParams,
	StemsParams
};
type ParamsSchemaName = keyof typeof PARAMS_SCHEMAS;

export const JobRequest = z
	.strictObject({
		/** ERMS's job id, and the idempotency key. */
		job_id: z.string().regex(/^[!-~]{1,200}$/, '1-200 printable ASCII characters, no spaces'),
		operation: Operation,
		input: InputFile,
		params: z.record(z.string(), z.unknown()).nullable().optional(),
		outputs: z.partialRecord(OutputName, OutputTarget).optional(),
		webhook: WebhookTarget.optional(),
		authorization: AuthorizationRef.optional()
	})
	.superRefine((req, ctx) => {
		const op = OPERATIONS[req.operation];
		if (req.params == null) {
			if (op.paramsRequired)
				ctx.addIssue({
					code: 'custom',
					path: ['params'],
					message: `${req.operation} needs params`
				});
		} else {
			const parsed = PARAMS_SCHEMAS[op.params].safeParse(req.params);
			for (const issue of parsed.error?.issues ?? [])
				ctx.addIssue({ code: 'custom', path: ['params', ...issue.path], message: issue.message });
		}
		const given = Object.keys(req.outputs ?? {}).sort();
		const wanted = [...op.outputs].sort();
		if (given.join() !== wanted.join())
			ctx.addIssue({
				code: 'custom',
				path: ['outputs'],
				message: `${req.operation} needs upload targets for [${wanted}], got [${given}]`
			});
	});
export type JobRequest = z.infer<typeof JobRequest>;

// --- Results --------------------------------------------------------------------------

/** Rounded to 0.01; null for silence. */
const Decibels = z.number().nullable();

const StreamFields = {
	sample_rate: z.int(),
	channels: z.int(),
	duration_seconds: z.number()
};

const LoudnessFields = {
	integrated_lufs: Decibels,
	loudness_range_lu: Decibels,
	true_peak_dbtp: Decibels,
	sample_peak_dbfs: Decibels
};

const TempoFields = {
	bpm: z.number().nullable(),
	confidence: z.number().min(0).max(1).nullable(),
	steady: z.boolean(),
	beat_count: z.int().min(0),
	beats: z.array(z.number().min(0))
};

const TONICS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;
const KeyName = z.string().regex(/^(C|C#|D|Eb|E|F|F#|G|Ab|A|Bb|B) (major|minor)$/);
const Camelot = z.string().regex(/^(1[0-2]|[1-9])[AB]$/);

const KeyFields = {
	key: KeyName.nullable(),
	tonic: z.enum(TONICS).nullable(),
	mode: z.enum(['major', 'minor']).nullable(),
	camelot: Camelot.nullable(),
	confidence: z.number().nullable(),
	tuning_cents: z.number().nullable(),
	candidates: z.array(z.strictObject({ key: KeyName, camelot: Camelot, score: z.number() })).max(3),
	chroma: z.array(z.number()).length(12).nullable()
};

const FingerprintFields = {
	fingerprint: z.string().nullable(),
	algorithm: z.literal('chromaprint-2'),
	fingerprint_seconds: z.number().min(0)
};

export const TagScore = z.strictObject({ tag: z.string(), score: z.number().min(0).max(1) });
export type TagScore = z.infer<typeof TagScore>;

/**
 * `model`, `windows`, optional `embedding`, plus one TagScore array per label group (`genre`,
 * `mood`, `vocals`...). The groups are checked by refinement so the declared fields keep their types.
 */
const tagsObject = <S extends z.ZodRawShape>(extra: S) => {
	const declared = new Set(['model', 'windows', 'embedding', ...Object.keys(extra)]);
	const groups = z.array(TagScore);
	return z
		.looseObject({
			model: z.string(),
			windows: z.int().min(1),
			embedding: z.array(z.number()).optional(),
			...extra
		})
		.superRefine((o, ctx) => {
			for (const [k, v] of Object.entries(o)) {
				if (declared.has(k)) continue;
				if (!groups.safeParse(v).success)
					ctx.addIssue({
						code: 'custom',
						path: [k],
						message: 'a tag group is an array of TagScore'
					});
			}
		});
};

export const TagsFields = tagsObject({});

export const ProbeResult = z.strictObject({
	container: z.string(),
	codec: z.string(),
	sample_rate: z.int(),
	channels: z.int(),
	bits_per_sample: z.int().nullable(),
	frames: z.int(),
	duration_seconds: z.number(),
	size_bytes: z.int(),
	decode_errors: z.int(),
	valid: z.boolean()
});
export const LoudnessResult = z.strictObject({ ...LoudnessFields, ...StreamFields });
export const TempoResult = z.strictObject({ ...TempoFields, ...StreamFields });
export const KeyResult = z.strictObject({ ...KeyFields, ...StreamFields });
export const FingerprintResult = z.strictObject({ ...FingerprintFields, ...StreamFields });
export const AnalyzeResult = z.strictObject({
	...StreamFields,
	loudness: z.strictObject(LoudnessFields),
	tempo: z.strictObject(TempoFields),
	key: z.strictObject(KeyFields),
	fingerprint: z.strictObject(FingerprintFields),
	/** null when the instance has no tag model. */
	tags: TagsFields.nullable().optional()
});
export const TagsResult = tagsObject(StreamFields);
export const WaveformResult = z.strictObject({
	points: z.int(),
	peaks: z.array(z.number().min(0).max(1)),
	...StreamFields
});

const AudioOutputFields = {
	format: Format,
	content_type: z.enum(['audio/wav', 'audio/flac', 'audio/mpeg', 'audio/mp4']),
	sample_rate: z.int(),
	channels: z.int(),
	duration_seconds: z.number(),
	bit_depth: z.int().optional(),
	bitrate_kbps: z.int().optional(),
	sha256: Sha256,
	size_bytes: z.int()
};
const exactlyOneOfDepthOrBitrate = (o: { bit_depth?: number; bitrate_kbps?: number }) =>
	(o.bit_depth === undefined) !== (o.bitrate_kbps === undefined);

/** What AudioKit uploaded. Re-hash what was stored and compare with sha256 and size_bytes. */
export const AudioOutput = z
	.strictObject(AudioOutputFields)
	.refine(exactlyOneOfDepthOrBitrate, 'exactly one of bit_depth and bitrate_kbps');
export const PreviewAudioOutput = z
	.strictObject({ ...AudioOutputFields, start_seconds: z.number(), fade_seconds: z.number() })
	.refine(exactlyOneOfDepthOrBitrate, 'exactly one of bit_depth and bitrate_kbps');

export const StemOutput = z.strictObject({
	sha256: Sha256,
	size_bytes: z.int().min(1),
	format: z.string().optional(),
	content_type: z.string().optional(),
	sample_rate: z.int().optional(),
	channels: z.int().optional(),
	duration_seconds: z.number().optional()
});
export type StemOutput = z.infer<typeof StemOutput>;

export const StemsResult = z.strictObject({
	model: StemsModel,
	outputs: z.strictObject({
		vocals: StemOutput,
		drums: StemOutput,
		bass: StemOutput,
		other: StemOutput
	})
});

export const TranscodeResult = z.strictObject({ outputs: z.strictObject({ audio: AudioOutput }) });
export const PreviewResult = z.strictObject({
	outputs: z.strictObject({ audio: PreviewAudioOutput })
});
export const NormalizeResult = z.strictObject({
	target_lufs: z.number(),
	true_peak_ceiling_dbtp: z.number(),
	target_reached: z.boolean(),
	gain_db: z.number(),
	before: z.strictObject(LoudnessFields),
	after: z.strictObject(LoudnessFields),
	outputs: z.strictObject({ audio: AudioOutput })
});

/** Result schema per operation (OpenAPI component names). */
export const RESULT_SCHEMAS = {
	probe: ProbeResult,
	loudness: LoudnessResult,
	waveform: WaveformResult,
	transcode: TranscodeResult,
	preview: PreviewResult,
	normalize: NormalizeResult,
	tempo: TempoResult,
	key: KeyResult,
	fingerprint: FingerprintResult,
	analyze: AnalyzeResult,
	tags: TagsResult,
	stems: StemsResult
} as const satisfies Record<Operation, z.ZodType>;

export type ResultFor<O extends Operation> = z.infer<(typeof RESULT_SCHEMAS)[O]>;

// --- Jobs -----------------------------------------------------------------------------

export const Provenance = z.strictObject({
	input_sha256: Sha256,
	audiokit_version: z.string(),
	operation: Operation,
	params: z.record(z.string(), z.unknown())
});
export type Provenance = z.infer<typeof Provenance>;

export const Job = z
	.strictObject({
		provider_job_id: z.uuid(),
		job_id: z.string(),
		operation: Operation,
		status: JobStatus,
		result: z.record(z.string(), z.unknown()).optional(),
		error: JobError.optional(),
		provenance: Provenance.optional(),
		created_at: z.iso.datetime({ offset: true }),
		started_at: z.iso.datetime({ offset: true }).optional(),
		finished_at: z.iso.datetime({ offset: true }).optional()
	})
	.superRefine((job, ctx) => {
		const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
		if (job.status === 'succeeded') {
			if (!job.result || !job.provenance || !job.finished_at)
				issue('a succeeded job has result, provenance and finished_at');
		} else if (job.result || job.provenance) {
			issue('only a succeeded job has result or provenance');
		}
		if (job.status === 'failed') {
			if (!job.error || !job.finished_at) issue('a failed job has error and finished_at');
		} else if (job.error) {
			issue('only a failed job has error');
		}
		if (job.result) {
			const parsed = RESULT_SCHEMAS[job.operation].safeParse(job.result);
			for (const i of parsed.error?.issues ?? [])
				ctx.addIssue({ code: 'custom', path: ['result', ...i.path], message: i.message });
		}
	});
export type Job = z.infer<typeof Job>;

export const WebhookEventType = z.enum(['job.succeeded', 'job.failed', 'job.canceled']);
export type WebhookEventType = z.infer<typeof WebhookEventType>;

export const WebhookEvent = z
	.strictObject({
		/** Unique per event; ERMS drops ones it has seen. */
		event_id: z.uuid(),
		type: WebhookEventType,
		created_at: z.iso.datetime({ offset: true }),
		data: Job
	})
	.refine((e) => e.type === `job.${e.data.status}`, 'type matches data.status');
export type WebhookEvent = z.infer<typeof WebhookEvent>;
