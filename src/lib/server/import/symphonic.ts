import { parse } from 'csv-parse/sync';
import type { CreditRole } from '../db/schema';
import {
	isValidGtin,
	isValidIsrc,
	normalizeIsrc,
	parseDuration,
	partyMatchKey,
	splitArtists
} from './identifiers';

/**
 * SymphonicMS "Inventory Export" (one row per track per release) to an import plan.
 * Pure: no database access, so it can be tested and previewed safely.
 */

export const SYMPHONIC_COLUMNS = [
	'Label Name',
	'Catalog #',
	'UPC',
	'Release Name',
	'Release Version',
	'Release Artist',
	'Release Date',
	'Release Genre',
	'Release Subgenre',
	'Track',
	'ISRC',
	'Song Name',
	'Mix Version',
	'Primary Artists',
	'Featuring Artists',
	'Remixers',
	'Track Length',
	'Song Genre',
	'Song Subgenre'
] as const;

type Row = Record<(typeof SYMPHONIC_COLUMNS)[number], string>;

export type Issue = {
	level: 'error' | 'warning';
	/** 1-based line number in the file, header = 1. */
	line: number | null;
	code: string;
	message: string;
};

export type PlannedCredit = { name: string; role: CreditRole; position: number };

export type PlannedRecording = {
	isrc: string;
	title: string;
	versionTitle: string | null;
	durationMs: number | null;
	genre: string | null;
	subgenre: string | null;
	credits: PlannedCredit[];
};

export type PlannedRelease = {
	upc: string;
	label: string;
	catalogNumber: string | null;
	title: string;
	versionTitle: string | null;
	type: 'single' | 'ep' | 'album' | 'compilation';
	releaseDate: string | null;
	genre: string | null;
	subgenre: string | null;
	artists: string[];
	tracks: { position: number; isrc: string }[];
};

export type ImportPlan = {
	labels: string[];
	/** match key to display name (first spelling seen wins). */
	parties: Map<string, string>;
	recordings: Map<string, PlannedRecording>;
	releases: Map<string, PlannedRelease>;
	issues: Issue[];
	rowCount: number;
};

/**
 * Canonical form of an uploaded file: no byte-order mark, LF line endings.
 * Browsers rewrite line endings to CRLF when a form posts text back, so the dry run
 * and the confirm step must hash and parse the same normalized text.
 */
export function normalizeCsvText(text: string): string {
	return text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

const blank = (s: string | undefined) => {
	const v = (s ?? '').trim();
	return v === '' ? null : v;
};

export function parseSymphonicInventory(csvText: string): ImportPlan {
	const issues: Issue[] = [];
	const plan: ImportPlan = {
		labels: [],
		parties: new Map(),
		recordings: new Map(),
		releases: new Map(),
		issues,
		rowCount: 0
	};

	let rows: Row[];
	try {
		rows = parse(csvText, {
			columns: true,
			bom: true,
			skip_empty_lines: true,
			trim: true,
			relax_column_count: false
		}) as Row[];
	} catch (e) {
		issues.push({
			level: 'error',
			line: null,
			code: 'csv_unreadable',
			message: `The file could not be read as CSV: ${(e as Error).message}`
		});
		return plan;
	}

	const header = Object.keys(rows[0] ?? {});
	const missing = SYMPHONIC_COLUMNS.filter((c) => !header.includes(c));
	if (rows.length > 0 && missing.length > 0) {
		issues.push({
			level: 'error',
			line: 1,
			code: 'missing_columns',
			message: `Not a SymphonicMS inventory export. Missing columns: ${missing.join(', ')}`
		});
		return plan;
	}

	plan.rowCount = rows.length;
	const labelSet = new Set<string>();
	const addParty = (name: string) => {
		const key = partyMatchKey(name);
		if (!plan.parties.has(key)) plan.parties.set(key, name);
	};

	rows.forEach((row, i) => {
		const line = i + 2;
		const isrc = normalizeIsrc(row.ISRC);
		const upc = row.UPC.trim();
		const title = blank(row['Song Name']);
		const releaseTitle = blank(row['Release Name']);
		const position = Number(row.Track);
		const label = blank(row['Label Name']);

		let rowOk = true;
		if (!isValidIsrc(isrc)) {
			issues.push({
				level: 'error',
				line,
				code: 'bad_isrc',
				message: `Invalid ISRC "${row.ISRC}"`
			});
			rowOk = false;
		}
		if (!isValidGtin(upc)) {
			issues.push({ level: 'error', line, code: 'bad_upc', message: `Invalid UPC "${row.UPC}"` });
			rowOk = false;
		}
		if (!title || !releaseTitle || !label) {
			issues.push({
				level: 'error',
				line,
				code: 'missing_field',
				message: 'Song name, release name and label are required'
			});
			rowOk = false;
		}
		if (!Number.isInteger(position) || position < 1) {
			issues.push({
				level: 'error',
				line,
				code: 'bad_track_number',
				message: `Invalid track number "${row.Track}"`
			});
			rowOk = false;
		}
		if (!rowOk) return;

		const durationMs = parseDuration(row['Track Length']);
		if (durationMs == null) {
			issues.push({
				level: 'warning',
				line,
				code: 'missing_duration',
				message: `${isrc} "${title}" has no track length`
			});
		}

		labelSet.add(label!);

		// Recording (identity = ISRC; the same recording can sit on several releases).
		const primary = splitArtists(row['Primary Artists']);
		const featuring = splitArtists(row['Featuring Artists']);
		const remixers = splitArtists(row.Remixers);
		[...primary, ...featuring, ...remixers].forEach(addParty);
		const credits: PlannedCredit[] = [
			...primary.map((name, p) => ({ name, role: 'main' as const, position: p })),
			...featuring.map((name, p) => ({ name, role: 'featured' as const, position: p })),
			...remixers.map((name, p) => ({ name, role: 'remixer' as const, position: p }))
		];
		if (primary.length === 0) {
			issues.push({
				level: 'error',
				line,
				code: 'no_primary_artist',
				message: `${isrc} has no primary artist`
			});
			return;
		}

		const incoming: PlannedRecording = {
			isrc,
			title: title!,
			versionTitle: blank(row['Mix Version']),
			durationMs,
			genre: blank(row['Song Genre']),
			subgenre: blank(row['Song Subgenre']),
			credits
		};
		const existing = plan.recordings.get(isrc);
		if (!existing) {
			plan.recordings.set(isrc, incoming);
		} else {
			mergeRecording(existing, incoming, line, issues);
		}

		// Release (identity = UPC).
		const releaseArtists = splitArtists(row['Release Artist']);
		releaseArtists.forEach(addParty);
		const rel = plan.releases.get(upc);
		const releaseFields = {
			label: label!,
			catalogNumber: blank(row['Catalog #']),
			title: releaseTitle!,
			versionTitle: blank(row['Release Version']),
			releaseDate: blank(row['Release Date']),
			genre: blank(row['Release Genre']),
			subgenre: blank(row['Release Subgenre'])
		};
		if (!rel) {
			plan.releases.set(upc, {
				upc,
				...releaseFields,
				type: 'single',
				artists: releaseArtists,
				tracks: [{ position, isrc }]
			});
		} else {
			for (const [field, value] of Object.entries(releaseFields)) {
				const current = rel[field as keyof typeof releaseFields];
				if (current !== value) {
					issues.push({
						level: 'error',
						line,
						code: 'release_conflict',
						message: `UPC ${upc}: "${field}" is "${value}" here but "${current}" on an earlier row`
					});
				}
			}
			if (rel.tracks.some((t) => t.position === position)) {
				issues.push({
					level: 'error',
					line,
					code: 'duplicate_track_number',
					message: `UPC ${upc} already has a track ${position}`
				});
			} else {
				rel.tracks.push({ position, isrc });
			}
		}
	});

	for (const rel of plan.releases.values()) {
		rel.tracks.sort((a, b) => a.position - b.position);
		rel.type = deriveReleaseType(rel, plan.recordings);
	}
	plan.labels = [...labelSet].sort();
	return plan;
}

function mergeRecording(
	existing: PlannedRecording,
	incoming: PlannedRecording,
	line: number,
	issues: Issue[]
) {
	if (existing.title !== incoming.title) {
		issues.push({
			level: 'warning',
			line,
			code: 'recording_title_conflict',
			message: `${incoming.isrc}: title "${incoming.title}" differs from "${existing.title}"; keeping the first`
		});
	}
	// A blank mix version on one release and a filled one on another: keep the filled one.
	if (existing.versionTitle !== incoming.versionTitle) {
		if (!existing.versionTitle && incoming.versionTitle) {
			existing.versionTitle = incoming.versionTitle;
		}
		issues.push({
			level: 'warning',
			line,
			code: 'recording_version_conflict',
			message: `${incoming.isrc}: mix version "${incoming.versionTitle ?? ''}" vs "${existing.versionTitle ?? ''}"; keeping "${existing.versionTitle ?? ''}"`
		});
	}
	if (existing.durationMs == null && incoming.durationMs != null) {
		existing.durationMs = incoming.durationMs;
	}
	// Union of credits: a credit listed on any release counts.
	for (const c of incoming.credits) {
		const key = (x: PlannedCredit) => `${x.role}|${partyMatchKey(x.name)}`;
		if (!existing.credits.some((e) => key(e) === key(c))) existing.credits.push(c);
	}
}

/**
 * Store-style release type (DSP convention): 1-3 tracks under 30 minutes is a single,
 * 4-6 under 30 minutes is an EP, otherwise an album. A release whose tracks don't all
 * credit the release artist as a main artist is a compilation.
 */
export function deriveReleaseType(
	rel: Pick<PlannedRelease, 'artists' | 'tracks'>,
	recordings: Map<string, PlannedRecording>
): PlannedRelease['type'] {
	const releaseKeys = new Set(rel.artists.map(partyMatchKey));
	const tracks = rel.tracks.map((t) => recordings.get(t.isrc)).filter((r) => r != null);
	const isCompilation =
		rel.tracks.length > 1 &&
		tracks.some(
			(r) => !r.credits.some((c) => c.role === 'main' && releaseKeys.has(partyMatchKey(c.name)))
		);
	if (isCompilation) return 'compilation';
	const knownMs = tracks.reduce((sum, r) => sum + (r.durationMs ?? 0), 0);
	const underThirty = knownMs < 30 * 60 * 1000;
	if (rel.tracks.length <= 3 && underThirty) return 'single';
	if (rel.tracks.length <= 6 && underThirty) return 'ep';
	return 'album';
}

export function summarizePlan(plan: ImportPlan) {
	const errors = plan.issues.filter((i) => i.level === 'error');
	return {
		rows: plan.rowCount,
		labels: plan.labels.length,
		parties: plan.parties.size,
		recordings: plan.recordings.size,
		releases: plan.releases.size,
		errors: errors.length,
		warnings: plan.issues.length - errors.length
	};
}
