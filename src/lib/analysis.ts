/**
 * Reads an analysis out of the AudioKit jobs ERMS already stores (EPSILON-30/31).
 *
 * The recording page shows one card per analysis concern. Each card is derived from the
 * newest job that can fill it: `pending` while a job is queued or submitted, `failed` with
 * the provider's reason, or `done` with the stored result. `analyze` returns loudness,
 * tempo, key and tags together, so those cards read from it as well as their own operation.
 *
 * This module is deliberately free of database and Svelte imports so the recording page can
 * import its types in the browser; the org-scoped query lives in `server/analysis.ts`.
 */

export type AnalysisStatus = 'pending' | 'failed' | 'done';

export type AnalysisCardKey =
	'probe' | 'loudness' | 'waveform' | 'preview' | 'tempo' | 'key' | 'tags';

const CARD_ORDER: readonly AnalysisCardKey[] = [
	'loudness',
	'probe',
	'waveform',
	'preview',
	'tempo',
	'key',
	'tags'
];

type SourceDef = {
	operation: string;
	/** Which field of the job result this card shows; the whole result when omitted. */
	field?: string;
};

type CardDef = { key: AnalysisCardKey; label: string; sources: readonly SourceDef[] };

export const ANALYSIS_CARDS: Record<AnalysisCardKey, CardDef> = {
	probe: { key: 'probe', label: 'Format', sources: [{ operation: 'probe' }] },
	loudness: {
		key: 'loudness',
		label: 'Loudness',
		sources: [{ operation: 'loudness' }, { operation: 'analyze', field: 'loudness' }]
	},
	waveform: { key: 'waveform', label: 'Waveform', sources: [{ operation: 'waveform' }] },
	preview: { key: 'preview', label: 'Preview', sources: [{ operation: 'preview' }] },
	tempo: {
		key: 'tempo',
		label: 'Tempo',
		sources: [{ operation: 'tempo' }, { operation: 'analyze', field: 'tempo' }]
	},
	key: {
		key: 'key',
		label: 'Key',
		sources: [{ operation: 'key' }, { operation: 'analyze', field: 'key' }]
	},
	tags: {
		key: 'tags',
		label: 'Tags',
		sources: [{ operation: 'tags' }, { operation: 'analyze', field: 'tags' }]
	}
};

/** The job fields the derivation needs; `listJobs` returns these. */
export type AnalysisJob = {
	id: string;
	operation: string;
	status: string;
	result: unknown;
	error: unknown;
	requestedAt: Date | string;
	finishedAt: Date | string | null;
};

export type AnalysisCard = {
	key: AnalysisCardKey;
	label: string;
	status: AnalysisStatus;
	/** Provider reason for the newest failed job, if there is one. */
	reason: string | null;
	/** The newest job for this card, whatever its outcome. */
	jobId: string | null;
	/** The job whose result is shown (the newest succeeded one), if any. */
	resultJobId: string | null;
	requestedAt: Date | string | null;
	finishedAt: Date | string | null;
	result: unknown | null;
};

export type Analysis = Record<AnalysisCardKey, AnalysisCard>;

/** Human-readable reason from AudioKit's `{ code, message }` job error (or anything else). */
export function reasonFrom(error: unknown): string | null {
	if (error == null) return null;
	if (typeof error === 'string') return error;
	if (typeof error === 'object') {
		const e = error as Record<string, unknown>;
		const message = typeof e.message === 'string' ? e.message.trim() : '';
		const code = typeof e.code === 'string' ? e.code.trim() : '';
		if (message) return message;
		if (code) return code;
		return null;
	}
	return String(error);
}

function asRecord(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function time(value: Date | string): number {
	const t = new Date(value).getTime();
	return Number.isNaN(t) ? 0 : t;
}

function deriveCard(def: CardDef, jobs: readonly AnalysisJob[]): AnalysisCard {
	const operations = new Set(def.sources.map((s) => s.operation));
	const candidates = jobs
		.filter((job) => operations.has(job.operation))
		.slice()
		.sort((a, b) => time(b.requestedAt) - time(a.requestedAt));
	const newest = candidates[0] ?? null;

	let status: AnalysisStatus = 'pending';
	let reason: string | null = null;
	if (newest) {
		if (newest.status === 'succeeded') status = 'done';
		else if (newest.status === 'failed') {
			status = 'failed';
			reason = reasonFrom(newest.error) ?? 'The provider reported a failure.';
		} else if (newest.status === 'canceled') {
			status = 'failed';
			reason = 'The job was canceled.';
		}
	}

	// Show the last good result even when a newer run is pending or failed, so a re-run
	// never blanks the page.
	const succeeded = candidates.find((job) => job.status === 'succeeded') ?? null;
	let result: unknown | null = null;
	if (succeeded) {
		const record = asRecord(succeeded.result);
		const source = def.sources.find((s) => s.operation === succeeded.operation);
		result = source?.field && record ? (record[source.field] ?? null) : record;
	}

	return {
		key: def.key,
		label: def.label,
		status,
		reason,
		jobId: newest?.id ?? null,
		resultJobId: succeeded?.id ?? null,
		requestedAt: newest?.requestedAt ?? null,
		finishedAt: newest?.finishedAt ?? null,
		result
	};
}

/** Derive every card's status and result from a recording's jobs. Pure, for tests. */
export function buildAnalysis(jobs: readonly AnalysisJob[]): Analysis {
	return Object.fromEntries(
		CARD_ORDER.map((key) => [key, deriveCard(ANALYSIS_CARDS[key], jobs)])
	) as Analysis;
}
