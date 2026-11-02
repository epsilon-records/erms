import { and, asc, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { Database } from './audit';
import { credits, labels, parties, recordings, releases } from './db/schema';

/**
 * Catalog search across releases, recordings and artists.
 *
 * Every word of the query must match the start of a word in the result (accents and case
 * ignored), so "vex ra" finds "Vexo Rand" and "rhone" finds "Rhône". Identifiers (ISRC,
 * UPC, catalog number) also match by prefix with or without separators, and an exact
 * identifier match ranks first. Results are scoped to one org; RLS backs that up.
 *
 * Documents are built per query. That is fine at catalog sizes in the low thousands;
 * beyond that, store them in indexed tsvector columns.
 */

export const SEARCH_LIMIT = 25;
/** Longest query we search on. Longer input is cut, not rejected. */
const MAX_QUERY = 120;
/** Identifier prefixes shorter than this would match too much. */
const MIN_CODE = 4;

export type SearchResults = {
	query: string;
	releases: {
		id: string;
		title: string;
		versionTitle: string | null;
		catalogNumber: string | null;
		upc: string;
		releaseDate: string | null;
		label: string;
		artists: string[];
	}[];
	recordings: {
		id: string;
		title: string;
		versionTitle: string | null;
		isrc: string;
		artists: string[];
	}[];
	artists: { id: string; name: string; credits: number }[];
};

export function normalizeQuery(raw: string | null | undefined): string {
	return (raw ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY);
}

/** Names credited on a release or recording, in credit order, as one string for the document. */
const creditedNames = (column: SQL) => sql<string>`(
	select coalesce(string_agg(${parties.displayName}, ' ' order by ${credits.position}), '')
	from ${credits} join ${parties} on ${parties.id} = ${credits.partyId}
	where ${column})`;

export async function searchCatalog(
	db: Database,
	orgId: string,
	raw: string
): Promise<SearchResults> {
	const query = normalizeQuery(raw);
	const empty: SearchResults = { query, releases: [], recordings: [], artists: [] };
	if (!query) return empty;

	const tsq = sql`app.search_query(${query})`;
	const code = sql`app.search_code(${query})`;
	const codeOk = sql`length(${code}) >= ${MIN_CODE}`;
	const doc = (...parts: SQL[]) =>
		sql`to_tsvector('simple', app.search_text(concat_ws(' ', ${sql.join(parts, sql`, `)})))`;

	// Releases: title, version, cat#, label and release artists; UPC and cat# as codes.
	const releaseDoc = doc(
		sql`${releases.title}`,
		sql`${releases.versionTitle}`,
		sql`${releases.catalogNumber}`,
		sql`${labels.name}`,
		creditedNames(sql`${credits.releaseId} = ${releases.id}`)
	);
	const releaseExact = sql<boolean>`(${codeOk} and (${releases.upc} = ${code} or app.search_code(${releases.catalogNumber}) = ${code}))`;
	const releaseRows = await db
		.select({
			id: releases.id,
			title: releases.title,
			versionTitle: releases.versionTitle,
			catalogNumber: releases.catalogNumber,
			upc: releases.upc,
			releaseDate: releases.releaseDate,
			label: labels.name
		})
		.from(releases)
		.innerJoin(labels, eq(labels.id, releases.labelId))
		.where(
			and(
				eq(releases.orgId, orgId),
				or(
					sql`${releaseDoc} @@ ${tsq}`,
					sql`(${codeOk} and (${releases.upc} like ${code} || '%' or app.search_code(${releases.catalogNumber}) like ${code} || '%'))`
				)
			)
		)
		.orderBy(
			desc(releaseExact),
			desc(sql`coalesce(ts_rank(${releaseDoc}, ${tsq}), 0)`),
			desc(releases.releaseDate),
			asc(releases.title)
		)
		.limit(SEARCH_LIMIT);

	// Recordings: title, version, genre and everyone credited; ISRC as a code.
	const recordingDoc = doc(
		sql`${recordings.title}`,
		sql`${recordings.versionTitle}`,
		sql`${recordings.genre}`,
		sql`${recordings.subgenre}`,
		creditedNames(sql`${credits.recordingId} = ${recordings.id}`)
	);
	const recordingRows = await db
		.select({
			id: recordings.id,
			title: recordings.title,
			versionTitle: recordings.versionTitle,
			isrc: recordings.isrc
		})
		.from(recordings)
		.where(
			and(
				eq(recordings.orgId, orgId),
				or(
					sql`${recordingDoc} @@ ${tsq}`,
					sql`(${codeOk} and ${recordings.isrc} like ${code} || '%')`
				)
			)
		)
		.orderBy(
			desc(sql`(${codeOk} and ${recordings.isrc} = ${code})`),
			desc(sql`coalesce(ts_rank(${recordingDoc}, ${tsq}), 0)`),
			asc(recordings.title),
			asc(recordings.versionTitle)
		)
		.limit(SEARCH_LIMIT);

	// Artists: name only.
	const artistDoc = doc(sql`${parties.displayName}`);
	const artistRows = await db
		.select({
			id: parties.id,
			name: parties.displayName,
			credits: sql<number>`(select count(*)::int from ${credits} where ${credits.partyId} = ${parties.id})`
		})
		.from(parties)
		.where(and(eq(parties.orgId, orgId), sql`${artistDoc} @@ ${tsq}`))
		.orderBy(
			desc(sql`coalesce(ts_rank(${artistDoc}, ${tsq}), 0)`),
			asc(sql`lower(${parties.displayName})`)
		)
		.limit(SEARCH_LIMIT);

	const [releaseArtists, recordingArtists] = await Promise.all([
		namesFor(
			db,
			'release',
			releaseRows.map((r) => r.id)
		),
		namesFor(
			db,
			'recording',
			recordingRows.map((r) => r.id)
		)
	]);

	return {
		query,
		releases: releaseRows.map((r) => ({ ...r, artists: releaseArtists.get(r.id) ?? [] })),
		recordings: recordingRows.map((r) => ({ ...r, artists: recordingArtists.get(r.id) ?? [] })),
		artists: artistRows
	};
}

/** Main and featured artists for display, in credit order. */
async function namesFor(db: Database, kind: 'release' | 'recording', ids: string[]) {
	const map = new Map<string, string[]>();
	if (!ids.length) return map;
	const target = kind === 'release' ? credits.releaseId : credits.recordingId;
	const rows = await db
		.select({ target, name: parties.displayName })
		.from(credits)
		.innerJoin(parties, eq(parties.id, credits.partyId))
		.where(and(inArray(target, ids), inArray(credits.role, ['main', 'featured'])))
		.orderBy(asc(credits.role), asc(credits.position));
	for (const r of rows) {
		const list = map.get(r.target!) ?? [];
		list.push(r.name);
		map.set(r.target!, list);
	}
	return map;
}
