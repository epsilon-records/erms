import { readFile } from 'node:fs/promises';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as contract from './contract';
import { JobRequest, OPERATIONS, RESULT_SCHEMAS, type Operation, type ResultFor } from './contract';
import { StubProvider } from './stub';
import { verify } from './webhook';

/**
 * Checks `contract.ts` against AudioKit's published OpenAPI contract, so drift on either side
 * fails CI. The contract isn't vendored into this public repo: set AUDIOKIT_OPENAPI to a path or
 * an https URL (e.g. https://<audiokit host>/v1/openapi.yaml). CI fetches it first; without it,
 * this suite fails in CI and is skipped locally.
 */
const source = process.env.AUDIOKIT_OPENAPI;

type Schema = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Spec = { components: { schemas: Record<string, Schema> }; paths: Schema; webhooks: Schema };

async function loadSpec(): Promise<Spec | null> {
	if (!source) return null;
	const text = /^https:\/\//.test(source)
		? await fetch(source).then((r) => {
				if (!r.ok) throw new Error(`GET ${source}: ${r.status}`);
				return r.text();
			})
		: await readFile(source, 'utf8');
	return parseYaml(text) as Spec;
}

const spec = await loadSpec();

if (!spec && process.env.CI) {
	it('has AudioKit’s contract to check against', () => {
		throw new Error(
			'AUDIOKIT_OPENAPI is not set. CI fetches it with the AUDIOKIT_OPENAPI_URL variable or the AUDIOKIT_READ_TOKEN secret.'
		);
	});
}

// --- Flatten both sides to comparable object descriptions -------------------------------

type Prop = {
	values?: string;
	minimum?: number;
	maximum?: number;
	pattern?: string;
	default?: string;
	nullable: boolean;
};
type Flat = { props: Record<string, Prop>; required: string[]; closed: 'yes' | 'no' | 'typed' };

const SAFE = Number.MAX_SAFE_INTEGER;

function makeResolver(root: Schema) {
	const resolve = (s: Schema): Schema => {
		if (s?.$ref) {
			const path = (s.$ref as string).replace(/^#\//, '').split('/');
			return resolve(path.reduce((o: Schema, k) => o[k], root));
		}
		return s;
	};
	return resolve;
}

function describeProp(s: Schema, resolve: (s: Schema) => Schema): Prop {
	s = resolve(s);
	let nullable = false;
	let base = s;
	const branches: Schema[] = (s.anyOf ?? s.allOf ?? []).map(resolve);
	if (Array.isArray(s.type) && s.type.includes('null')) nullable = true;
	if (s.anyOf) {
		const nonNull = branches.filter((b) => b.type !== 'null');
		nullable ||= nonNull.length < branches.length;
		if (nonNull.length === 1) base = { ...nonNull[0], default: s.default ?? nonNull[0].default };
		else if (nonNull.every((b) => 'const' in b))
			base = { enum: nonNull.map((b) => b.const), default: s.default };
	} else if (s.allOf?.length === 1) {
		base = { ...branches[0], ...s, allOf: undefined };
	}
	const values = base.enum ?? ('const' in base ? [base.const] : undefined);
	const num = (n: unknown) => (typeof n === 'number' && Math.abs(n) < SAFE ? n : undefined);
	const prop: Prop = {
		nullable,
		values: values ? JSON.stringify([...values].filter((v) => v !== null).sort()) : undefined,
		minimum: num(base.minimum),
		maximum: num(base.maximum),
		// Zod adds its own regex for formats such as uuid and date-time.
		pattern: base.format ? undefined : base.pattern,
		default: base.default === undefined ? undefined : JSON.stringify(base.default)
	};
	return Object.fromEntries(Object.entries(prop).filter(([, v]) => v !== undefined)) as Prop;
}

function flatten(s: Schema, resolve: (s: Schema) => Schema): Flat {
	s = resolve(s);
	const props: Record<string, Prop> = {};
	const required = new Set<string>();
	let closed: Flat['closed'] = 'no';
	const visit = (x: Schema) => {
		x = resolve(x);
		for (const part of x.allOf ?? []) visit(part);
		for (const [k, v] of Object.entries((x.properties ?? {}) as Record<string, Schema>))
			props[k] = describeProp(v, resolve);
		for (const r of x.required ?? []) required.add(r);
		if (x.additionalProperties === false || x.unevaluatedProperties === false) closed = 'yes';
		else if (typeof x.additionalProperties === 'object') closed = 'typed';
	};
	visit(s);
	return { props, required: [...required].sort(), closed };
}

function fromZod(schema: z.ZodType): Flat {
	const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Schema;
	return flatten(json, makeResolver(json));
}

// Every OpenAPI component that has a counterpart in contract.ts, by the same name.
const PAIRS: Record<string, z.ZodType> = {
	Health: contract.Health,
	Capabilities: contract.Capabilities,
	Capability: contract.Capability,
	Error: contract.ApiError,
	JobError: contract.JobError,
	InputFile: contract.InputFile,
	OutputTarget: contract.OutputTarget,
	WebhookTarget: contract.WebhookTarget,
	AuthorizationRef: contract.AuthorizationRef,
	JobRequest: contract.JobRequest,
	...contract.PARAMS_SCHEMAS,
	Job: contract.Job,
	Provenance: contract.Provenance,
	WebhookEvent: contract.WebhookEvent,
	ProbeResult: contract.ProbeResult,
	LoudnessResult: contract.LoudnessResult,
	TempoResult: contract.TempoResult,
	KeyResult: contract.KeyResult,
	FingerprintResult: contract.FingerprintResult,
	AnalyzeResult: contract.AnalyzeResult,
	TagsResult: contract.TagsResult,
	WaveformResult: contract.WaveformResult,
	TagScore: contract.TagScore,
	AudioOutput: contract.AudioOutput,
	PreviewAudioOutput: contract.PreviewAudioOutput,
	TranscodeResult: contract.TranscodeResult,
	PreviewResult: contract.PreviewResult,
	NormalizeResult: contract.NormalizeResult,
	StemOutput: contract.StemOutput,
	StemsResult: contract.StemsResult
};

// Sample results per operation: shapes only, no catalog data.
const stream = { sample_rate: 48000, channels: 2, duration_seconds: 200.5 };
const loud = {
	integrated_lufs: -9.1,
	loudness_range_lu: 5.2,
	true_peak_dbtp: -1,
	sample_peak_dbfs: -1.1
};
const tempo = { bpm: 124, confidence: 0.9, steady: true, beat_count: 2, beats: [0.5, 0.984] };
const key = {
	key: 'A minor',
	tonic: 'A',
	mode: 'minor',
	camelot: '8A',
	confidence: 0.7,
	tuning_cents: -3,
	candidates: [{ key: 'A minor', camelot: '8A', score: 0.7 }],
	chroma: Array(12).fill(0.5)
};
const fp = { fingerprint: 'AQAA', algorithm: 'chromaprint-2', fingerprint_seconds: 120 };
const tags = {
	model: 'clap',
	windows: 20,
	genre: [{ tag: 'techno', score: 0.8 }],
	mood: [{ tag: 'dark', score: 0.6 }]
};
const audio = {
	format: 'mp3' as const,
	content_type: 'audio/mpeg' as const,
	...stream,
	bitrate_kbps: 192,
	sha256: 'b'.repeat(64),
	size_bytes: 1000
};
const stem = { sha256: 'c'.repeat(64), size_bytes: 1000 };
const SAMPLE_RESULTS: { [O in Operation]: ResultFor<O> } = {
	probe: {
		container: 'wave',
		codec: 'pcm_s24le',
		...stream,
		bits_per_sample: 24,
		frames: 9624000,
		size_bytes: 57744044,
		decode_errors: 0,
		valid: true
	},
	loudness: { ...loud, ...stream },
	waveform: { points: 3, peaks: [0.1, 0.9, 0.4], ...stream },
	transcode: { outputs: { audio } },
	preview: {
		outputs: { audio: { ...audio, duration_seconds: 30, start_seconds: 60, fade_seconds: 1 } }
	},
	normalize: {
		target_lufs: -14,
		true_peak_ceiling_dbtp: -1,
		target_reached: true,
		gain_db: 5.3,
		before: loud,
		after: { ...loud, integrated_lufs: -14 },
		outputs: { audio }
	},
	tempo: { ...tempo, ...stream },
	key: { ...(key as ResultFor<'key'>), ...stream },
	fingerprint: { ...(fp as ResultFor<'fingerprint'>), ...stream },
	analyze: {
		...stream,
		loudness: loud,
		tempo,
		key: key as ResultFor<'analyze'>['key'],
		fingerprint: fp as ResultFor<'analyze'>['fingerprint'],
		tags
	},
	tags: { ...tags, ...stream },
	stems: {
		model: 'htdemucs_ft',
		outputs: { vocals: stem, drums: stem, bass: stem, other: stem }
	}
};

function requestFor(op: Operation, jobId: string): JobRequest {
	return {
		job_id: jobId,
		operation: op,
		input: { url: 'https://r2.example/get/master.wav?sig=a', sha256: 'a'.repeat(64) },
		...(op === 'transcode' ? { params: { format: 'flac' } } : {}),
		...(op === 'normalize' ? { params: { target_lufs: -14 } } : {}),
		...(OPERATIONS[op].outputs.length
			? {
					outputs: Object.fromEntries(
						OPERATIONS[op].outputs.map((name) => [
							name,
							{ url: 'https://r2.example/put/out?sig=b', headers: { 'x-a': '1' } }
						])
					)
				}
			: {}),
		webhook: { url: 'https://erms.example/api/webhooks/audiokit' },
		authorization: { decision_id: 'authz-1', purpose: 'analysis' }
	};
}

describe.skipIf(!spec)('contract.ts matches AudioKit’s openapi.yaml', () => {
	const s = spec as Spec;
	const schemas = s?.components.schemas ?? {};
	const resolve = makeResolver(s ?? {});
	const ajv = new Ajv2020({ strict: false, allErrors: true });
	addFormats(ajv);
	if (s) ajv.addSchema(s as object, 'audiokit');
	const validate = (component: string, data: unknown) => {
		const v = ajv.getSchema(`audiokit#/components/schemas/${component}`)!;
		const ok = v(data) as boolean;
		return { ok, errors: ajv.errorsText(v.errors) };
	};

	it.each(Object.keys(PAIRS))('%s has the same fields, required fields and limits', (name) => {
		expect(schemas[name], `${name} is no longer in openapi.yaml`).toBeDefined();
		expect(fromZod(PAIRS[name])).toEqual(flatten(schemas[name], resolve));
	});

	it('covers every request, result and job schema in the spec', () => {
		const ignored = new Set([
			// Building blocks, enums and scalars, checked through the schemas that use them.
			...['ApiErrorCode', 'JobErrorCode', 'Operation', 'OutputName', 'Sha256', 'HttpsUrl'],
			...['Format', 'SampleRate', 'JobStatus', 'Decibels', 'KeyName', 'Camelot', 'StemsModel'],
			...['StreamFields', 'LoudnessFields', 'TempoFields', 'KeyFields', 'FingerprintFields'],
			...['TagsFields', 'AudioOutputFields'],
			// The admin client API (billing service: key sync and account erasure), not part of the
			// Jobs API ERMS calls.
			'ClientUpsert',
			'ClientErased',
			// GET /v1/ready (AudioKit #44, EPSILON-105): a readiness probe for monitoring.
			// LabelKit doesn't call it.
			'Ready'
		]);
		const missing = Object.keys(schemas).filter((n) => !(n in PAIRS) && !ignored.has(n));
		expect(missing, 'new components in openapi.yaml need a counterpart in contract.ts').toEqual([]);
	});

	it.each([
		['/v1/capabilities', 'get'],
		['/v1/openapi.yaml', 'get'],
		['/v1/jobs', 'post'],
		['/v1/jobs/{provider_job_id}', 'get'],
		['/v1/jobs/{provider_job_id}/cancel', 'post']
	])('%s %s publishes the rate-limit error and delay', (path, method) => {
		const response = resolve(s.paths[path][method].responses['429']);
		expect(response.content['application/json'].schema).toEqual({
			$ref: '#/components/schemas/Error'
		});
		expect(resolve(response.headers['Retry-After']).schema).toEqual({
			type: 'integer',
			minimum: 1
		});
		const error = { error: { code: 'rate_limited', message: 'Too much traffic' } };
		expect(validate('Error', error)).toEqual({ ok: true, errors: 'No errors' });
		expect(contract.ApiError.parse(error)).toEqual(error);
	});

	it('has the same enums', () => {
		const e = (n: string) => [...resolve(schemas[n]).enum].sort();
		expect([...contract.Operation.options].sort()).toEqual(e('Operation'));
		expect([...contract.JobStatus.options].sort()).toEqual(e('JobStatus'));
		expect([...contract.OutputName.options].sort()).toEqual(e('OutputName'));
		expect([...contract.Format.options].sort()).toEqual(e('Format'));
		expect([...contract.WebhookEventType.options].sort()).toEqual(
			[...schemas.WebhookEvent.properties.type.enum].sort()
		);
		expect([...contract.KNOWN_API_ERROR_CODES].sort()).toEqual(
			[...schemas.ApiErrorCode.anyOf[0].enum].sort()
		);
		const deprecated = (schemas.ApiErrorCode.anyOf as Schema[])
			.filter((s) => s.deprecated && s.enum)
			.flatMap((s) => s.enum as string[]);
		expect([...contract.DEPRECATED_API_ERROR_CODES].sort()).toEqual(deprecated.sort());
		expect([...contract.KNOWN_JOB_ERROR_CODES].sort()).toEqual(
			[...schemas.JobErrorCode.anyOf[0].enum].sort()
		);
	});

	it('pairs each operation with the same params, outputs and result schema', () => {
		const expected: Record<
			string,
			{ params?: string; paramsRequired?: boolean; outputs?: string[] }
		> = {};
		for (const rule of schemas.JobRequest.allOf as Schema[]) {
			const opSchema = rule.if.properties.operation;
			const ops: string[] = opSchema.enum ?? [opSchema.const];
			const then = rule.then;
			for (const op of ops) {
				const e = (expected[op] ??= {});
				const params = then.properties?.params;
				if (params) {
					const ref = params.$ref ?? params.anyOf?.find((b: Schema) => b.$ref)?.$ref;
					e.params = ref.split('/').pop();
					e.paramsRequired = (then.required ?? []).includes('params');
				}
				const outputs = then.properties?.outputs;
				if (outputs?.required) e.outputs = outputs.required;
				if (outputs?.maxProperties === 0) e.outputs = [];
			}
		}
		const ours = Object.fromEntries(
			Object.entries(OPERATIONS).map(([op, o]) => [
				op,
				{ params: o.params, paramsRequired: o.paramsRequired, outputs: [...o.outputs] }
			])
		);
		expect(ours).toEqual(expected);

		for (const rule of schemas.Job.allOf as Schema[]) {
			const op = rule.if.properties.operation?.const as Operation | undefined;
			if (!op) continue;
			const name = rule.then.properties.result.$ref.split('/').pop();
			expect(RESULT_SCHEMAS[op], `${op} result`).toBe(PAIRS[name]);
		}
	});

	it('parses the spec’s request examples', () => {
		const examples = s.paths['/v1/jobs'].post.requestBody.content['application/json'].examples;
		for (const [name, ex] of Object.entries(examples as Record<string, Schema>)) {
			expect(JobRequest.safeParse(ex.value).success, name).toBe(true);
		}
	});

	it('agrees with the spec on which requests are valid', () => {
		const base = requestFor('loudness', 'erms-1');
		// Where ERMS is deliberately stricter than the schema (the spec says it in prose only).
		const STRICTER = new Set<string>([]);
		const cases: [string, unknown][] = [
			...(Object.keys(OPERATIONS) as Operation[]).map(
				(op) => [`valid ${op}`, requestFor(op, `erms-${op}`)] as [string, unknown]
			),
			['http input', { ...base, input: { ...base.input, url: 'http://x.example/a' } }],
			['bad sha256', { ...base, input: { ...base.input, sha256: 'zz' } }],
			['unknown field', { ...base, schema_version: '1.0' }],
			['params on loudness', { ...base, params: { points: 100 } }],
			['outputs on loudness', { ...requestFor('preview', 'p'), operation: 'loudness' }],
			['preview without outputs', { ...base, operation: 'preview' }],
			['transcode without params', { ...requestFor('transcode', 't'), params: undefined }],
			[
				'transcode mp3 with bit_depth',
				{ ...requestFor('transcode', 't'), params: { format: 'mp3', bit_depth: 16 } }
			],
			['waveform points too low', { ...requestFor('waveform', 'w'), params: { points: 5 } }],
			['tempo with unknown param', { ...requestFor('tempo', 'w'), params: { bpm: 1 } }],
			['job_id with a space', { ...base, job_id: 'a b' }],
			['null params', { ...base, params: null }]
		];
		for (const [name, req] of cases) {
			const body = JSON.parse(JSON.stringify(req));
			const theirs = validate('JobRequest', body);
			const expected = STRICTER.has(name) ? false : theirs.ok;
			expect(
				JobRequest.safeParse(body).success,
				`${name}: spec says ${theirs.ok} (${theirs.errors})`
			).toBe(expected);
			if (STRICTER.has(name))
				expect(theirs.ok, `${name} is now rejected by the spec too`).toBe(true);
		}
	});

	it('the stub speaks the spec: capabilities, jobs and every webhook type', async () => {
		const p = new StubProvider('whsec_test');
		const caps = { operations: await p.capabilities() };
		expect(validate('Capabilities', caps)).toEqual({ ok: true, errors: 'No errors' });

		for (const op of Object.keys(OPERATIONS) as Operation[]) {
			const job = await p.submit(requestFor(op, `erms-${op}`));
			expect(validate('Job', job).errors, `queued ${op}`).toBe('No errors');
			p.startJob(job.provider_job_id);
			expect(validate('Job', await p.status(job.provider_job_id)).errors).toBe('No errors');
			const { event } = p.completeJob(job.provider_job_id, SAMPLE_RESULTS[op]);
			expect(validate('WebhookEvent', event).errors, `succeeded ${op}`).toBe('No errors');
		}

		const failed = await p.submit(requestFor('probe', 'erms-fail'));
		const { event: f } = p.failJob(failed.provider_job_id, { code: 'corrupt_input', message: 'x' });
		expect(validate('WebhookEvent', f).errors).toBe('No errors');

		const canceled = await p.submit(requestFor('probe', 'erms-cancel'));
		const c = await p.cancel(canceled.provider_job_id);
		expect(validate('WebhookEvent', p.webhookFor(c).event).errors).toBe('No errors');
	});

	it('verifies the webhook test vector', () => {
		const v = s.webhooks.jobFinished.post['x-signature-test-vector'];
		const t = Number(/t=(\d+)/.exec(v.header)![1]);
		expect(verify(v.secret, v.body, v.header, t)).toEqual({ ok: true, timestamp: t });
		expect(s.webhooks.jobFinished.post.parameters[0].name.toLowerCase()).toBe('x-signature');
	});
});
