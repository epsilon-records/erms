import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildAnalysis, reasonFrom, type AnalysisJob } from '../analysis';
import { latestReadyMasterId, recordingAnalysis } from './analysis';
import { audiokitJobs, masters, orgs, recordings } from './db/schema';
import { uuidv7 } from './db/uuidv7';
import { createTestDb } from './test-db';

const loudness = {
	integrated_lufs: -9.1,
	true_peak_dbtp: -0.8,
	loudness_range_lu: 5.2,
	sample_peak_dbfs: -1.1,
	sample_rate: 48000,
	channels: 2,
	duration_seconds: 200.5
};

const job = (
	over: Partial<AnalysisJob> & Pick<AnalysisJob, 'id' | 'operation' | 'status'>
): AnalysisJob => ({
	result: null,
	error: null,
	requestedAt: new Date('2026-01-01T00:00:00Z'),
	finishedAt: null,
	...over
});

describe('analysis status derivation', () => {
	it('reports every card as pending until a job runs', () => {
		const analysis = buildAnalysis([]);
		for (const card of Object.values(analysis)) {
			expect(card.status).toBe('pending');
			expect(card.jobId).toBeNull();
			expect(card.result).toBeNull();
		}
	});

	it('keeps a queued job pending', () => {
		const analysis = buildAnalysis([job({ id: 'j1', operation: 'loudness', status: 'queued' })]);
		expect(analysis.loudness.status).toBe('pending');
		expect(analysis.loudness.jobId).toBe('j1');
		expect(analysis.loudness.result).toBeNull();
	});

	it('reports a succeeded job as done with its result', () => {
		const analysis = buildAnalysis([
			job({
				id: 'j1',
				operation: 'loudness',
				status: 'succeeded',
				result: loudness,
				finishedAt: new Date('2026-01-01T01:00:00Z')
			})
		]);
		expect(analysis.loudness.status).toBe('done');
		expect(analysis.loudness.result).toEqual(loudness);
		expect(analysis.loudness.resultJobId).toBe('j1');
		expect(analysis.loudness.reason).toBeNull();
	});

	it('carries the provider reason for a failure', () => {
		const analysis = buildAnalysis([
			job({
				id: 'j1',
				operation: 'probe',
				status: 'failed',
				error: { code: 'corrupt_input', message: 'The file has no valid header.' }
			})
		]);
		expect(analysis.probe.status).toBe('failed');
		expect(analysis.probe.reason).toBe('The file has no valid header.');
	});

	it('treats a canceled job as failed', () => {
		const analysis = buildAnalysis([job({ id: 'j1', operation: 'waveform', status: 'canceled' })]);
		expect(analysis.waveform.status).toBe('failed');
		expect(analysis.waveform.reason).toMatch(/canceled/i);
	});

	it('reads loudness, tempo, key and tags out of one analyze result', () => {
		const analysis = buildAnalysis([
			job({
				id: 'j1',
				operation: 'analyze',
				status: 'succeeded',
				result: {
					sample_rate: 48000,
					channels: 2,
					duration_seconds: 200,
					loudness: {
						integrated_lufs: -9.1,
						true_peak_dbtp: -0.8,
						loudness_range_lu: 5.2,
						sample_peak_dbfs: -1.1
					},
					tempo: { bpm: 124, confidence: 0.9, steady: true, beat_count: 2, beats: [0.5] },
					key: { key: 'A minor', camelot: '8A', confidence: 0.7 },
					tags: { model: 'clap', windows: 20, genre: [{ tag: 'techno', score: 0.8 }] }
				}
			})
		]);
		expect(analysis.loudness.status).toBe('done');
		expect(analysis.loudness.result).toMatchObject({ integrated_lufs: -9.1 });
		expect(analysis.tempo.result).toMatchObject({ bpm: 124 });
		expect(analysis.key.result).toMatchObject({ key: 'A minor' });
		expect(analysis.tags.result).toMatchObject({ model: 'clap' });
		// analyze does not produce a probe or a waveform
		expect(analysis.probe.status).toBe('pending');
		expect(analysis.waveform.status).toBe('pending');
	});

	it('uses the newest job for status but keeps the last good result', () => {
		const analysis = buildAnalysis([
			job({
				id: 'old',
				operation: 'loudness',
				status: 'succeeded',
				result: loudness,
				requestedAt: new Date('2026-01-01T00:00:00Z')
			}),
			job({
				id: 'new',
				operation: 'loudness',
				status: 'failed',
				error: { message: 'timed out' },
				requestedAt: new Date('2026-01-02T00:00:00Z')
			})
		]);
		expect(analysis.loudness.status).toBe('failed');
		expect(analysis.loudness.reason).toBe('timed out');
		expect(analysis.loudness.jobId).toBe('new');
		expect(analysis.loudness.result).toEqual(loudness);
		expect(analysis.loudness.resultJobId).toBe('old');
	});

	describe('reasonFrom', () => {
		it('prefers the message, falls back to the code, and passes strings through', () => {
			expect(reasonFrom({ code: 'timeout', message: 'took too long' })).toBe('took too long');
			expect(reasonFrom({ code: 'timeout' })).toBe('timeout');
			expect(reasonFrom('nope')).toBe('nope');
			expect(reasonFrom(null)).toBeNull();
		});
	});
});

describe('recording analysis page data', () => {
	let db: Awaited<ReturnType<typeof createTestDb>>['db'];
	let orgId: string;
	let recordingId: string;
	let masterId: string;

	beforeAll(async () => {
		({ db } = await createTestDb());
		const [org] = await db.insert(orgs).values({ name: 'Label', slug: 'label' }).returning();
		orgId = org.id;
		const [recording] = await db
			.insert(recordings)
			.values({ orgId, isrc: 'USABC1234567', title: 'Track' })
			.returning();
		recordingId = recording.id;
		masterId = uuidv7();
		await db.insert(masters).values({
			id: masterId,
			orgId,
			recordingId,
			objectKey: `orgs/${orgId}/recordings/${recordingId}/masters/${masterId}.wav`,
			format: 'wav',
			sizeBytes: 2048,
			sha256: 'a'.repeat(64),
			fileName: 'Master.wav',
			status: 'ready',
			uploadedBy: 'tester',
			completedAt: new Date()
		});
	});

	beforeEach(async () => {
		await db.delete(audiokitJobs).where(eq(audiokitJobs.recordingId, recordingId));
	});

	async function addJob(
		operation: string,
		status: 'queued' | 'submitted' | 'succeeded' | 'failed' | 'canceled',
		extra: { result?: unknown; error?: unknown; requestedAt?: Date } = {}
	) {
		const finished = status === 'succeeded' || status === 'failed' || status === 'canceled';
		const [row] = await db
			.insert(audiokitJobs)
			.values({
				orgId,
				recordingId,
				masterId,
				operation,
				status,
				providerJobId: status === 'queued' ? null : uuidv7(),
				submittedAt: status === 'queued' ? null : new Date(),
				finishedAt: finished ? new Date() : null,
				result: extra.result ?? null,
				error: extra.error ?? null,
				requestedAt: extra.requestedAt ?? new Date(),
				requestedBy: 'tester'
			})
			.returning();
		return row;
	}

	it('derives the page cards from the stored jobs', async () => {
		await addJob('probe', 'succeeded', {
			result: {
				container: 'wave',
				codec: 'pcm_s24le',
				duration_seconds: 200.5,
				sample_rate: 48000,
				channels: 2,
				bits_per_sample: 24
			}
		});
		await addJob('waveform', 'submitted');
		await addJob('loudness', 'failed', {
			error: { code: 'internal', message: 'AudioKit blew up' }
		});

		const analysis = await recordingAnalysis(db, orgId, recordingId);
		expect(analysis.probe.status).toBe('done');
		expect(analysis.probe.result).toMatchObject({ container: 'wave' });
		expect(analysis.waveform.status).toBe('pending');
		expect(analysis.waveform.jobId).not.toBeNull();
		expect(analysis.loudness.status).toBe('failed');
		expect(analysis.loudness.reason).toBe('AudioKit blew up');
		expect(analysis.preview.status).toBe('pending');
		expect(analysis.preview.jobId).toBeNull();
	});

	it('scopes to the recording and the org', async () => {
		await addJob('key', 'succeeded', {
			result: { key: 'A minor', camelot: '8A', confidence: 0.7 }
		});
		const otherRecording = await recordingAnalysis(db, orgId, uuidv7());
		expect(otherRecording.key.status).toBe('pending');
		const otherOrg = await recordingAnalysis(db, uuidv7(), recordingId);
		expect(otherOrg.key.status).toBe('pending');
	});

	it('finds the newest ready master for a re-run', async () => {
		expect(await latestReadyMasterId(db, orgId, recordingId)).toBe(masterId);
		expect(await latestReadyMasterId(db, orgId, uuidv7())).toBeNull();
	});
});
