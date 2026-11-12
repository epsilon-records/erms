// Mock data for Storybook only (shared 0047: no real data in stories).
import { buildAnalysis, type AnalysisJob } from '#lib/analysis.js';

const at = (min: number) => new Date(Date.UTC(2026, 10, 12, 10, min));

function job(operation: string, status: string, result: unknown, min: number, error?: unknown) {
	return {
		id: `job-${operation}-${min}`,
		operation,
		status,
		result,
		error: error ?? null,
		requestedAt: at(min),
		finishedAt: status === 'queued' || status === 'running' ? null : at(min + 1)
	} satisfies AnalysisJob;
}

export const analysisEmpty = buildAnalysis([]);

export const analysisDone = buildAnalysis([
	job(
		'loudness',
		'succeeded',
		{ integrated_lufs: -8.4, true_peak_dbtp: -0.9, loudness_range_lu: 5.2 },
		1
	),
	job(
		'probe',
		'succeeded',
		{
			container: 'wav',
			codec: 'pcm_s24le',
			sample_rate: 48000,
			bits_per_sample: 24,
			channels: 2,
			duration_seconds: 412.6
		},
		2
	),
	job(
		'waveform',
		'succeeded',
		{ peaks: Array.from({ length: 120 }, (_, i) => Math.abs(Math.sin(i / 6)) * 0.9) },
		3
	),
	job('preview', 'succeeded', { duration_seconds: 30 }, 4),
	job('tempo', 'succeeded', { bpm: 132, confidence: 0.94, steady: true }, 5),
	job('key', 'succeeded', { key: 'A minor', camelot: '8A', confidence: 0.81 }, 6),
	job(
		'tags',
		'succeeded',
		{
			genre: [
				{ tag: 'techno', score: 0.91 },
				{ tag: 'acid', score: 0.62 },
				{ tag: 'trance', score: 0.31 }
			],
			mood: [
				{ tag: 'driving', score: 0.84 },
				{ tag: 'hypnotic', score: 0.77 }
			]
		},
		7
	)
]);

export const analysisMixed = buildAnalysis([
	job(
		'loudness',
		'succeeded',
		{ integrated_lufs: -9.1, true_peak_dbtp: -1.2, loudness_range_lu: 6.0 },
		1
	),
	job('loudness', 'failed', null, 9, {
		code: 'decode_failed',
		message: 'The file could not be decoded.'
	}),
	job('tempo', 'running', null, 8),
	job('key', 'failed', null, 7, { code: 'timeout', message: 'AudioKit did not answer in time.' })
]);
