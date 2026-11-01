import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Database } from './audit';
import {
	credits,
	importRuns,
	labels,
	parties,
	recordings,
	releases,
	releaseTracks
} from './db/schema';

/** Read-side queries for the catalog screens. Every query is scoped to one org. */

export async function listReleases(db: Database, orgId: string) {
	const rows = await db
		.select({
			id: releases.id,
			title: releases.title,
			versionTitle: releases.versionTitle,
			type: releases.type,
			releaseDate: releases.releaseDate,
			catalogNumber: releases.catalogNumber,
			upc: releases.upc,
			label: labels.name,
			trackCount: sql<number>`(select count(*)::int from ${releaseTracks} where ${releaseTracks.releaseId} = ${releases.id})`
		})
		.from(releases)
		.innerJoin(labels, eq(labels.id, releases.labelId))
		.where(eq(releases.orgId, orgId))
		.orderBy(desc(releases.releaseDate), asc(releases.title));
	const artists = await releaseArtists(
		db,
		rows.map((r) => r.id)
	);
	return rows.map((r) => ({ ...r, artists: artists.get(r.id) ?? [] }));
}

async function releaseArtists(db: Database, releaseIds: string[]) {
	const map = new Map<
		string,
		{ id: string; name: string; creditId: string; approvedAt: Date | null }[]
	>();
	if (!releaseIds.length) return map;
	const rows = await db
		.select({
			releaseId: credits.releaseId,
			id: parties.id,
			name: parties.displayName,
			creditId: credits.id,
			approvedAt: credits.approvedAt
		})
		.from(credits)
		.innerJoin(parties, eq(parties.id, credits.partyId))
		.where(and(inArray(credits.releaseId, releaseIds), eq(credits.role, 'main')))
		.orderBy(asc(credits.position));
	for (const r of rows) {
		const list = map.get(r.releaseId!) ?? [];
		list.push({ id: r.id, name: r.name, creditId: r.creditId, approvedAt: r.approvedAt });
		map.set(r.releaseId!, list);
	}
	return map;
}

export async function getRelease(db: Database, orgId: string, id: string) {
	const [release] = await db
		.select({ release: releases, label: labels.name })
		.from(releases)
		.innerJoin(labels, eq(labels.id, releases.labelId))
		.where(and(eq(releases.orgId, orgId), eq(releases.id, id)));
	if (!release) return null;

	const tracks = await db
		.select({
			position: releaseTracks.position,
			disc: releaseTracks.disc,
			recording: recordings
		})
		.from(releaseTracks)
		.innerJoin(recordings, eq(recordings.id, releaseTracks.recordingId))
		.where(eq(releaseTracks.releaseId, id))
		.orderBy(asc(releaseTracks.disc), asc(releaseTracks.position));

	const recordingIds = tracks.map((t) => t.recording.id);
	const trackCredits = recordingIds.length
		? await db
				.select({
					id: credits.id,
					approvedAt: credits.approvedAt,
					recordingId: credits.recordingId,
					role: credits.role,
					position: credits.position,
					partyId: parties.id,
					name: parties.displayName
				})
				.from(credits)
				.innerJoin(parties, eq(parties.id, credits.partyId))
				.where(inArray(credits.recordingId, recordingIds))
				.orderBy(asc(credits.role), asc(credits.position))
		: [];

	const artists = (await releaseArtists(db, [id])).get(id) ?? [];
	return {
		...release.release,
		label: release.label,
		artists,
		tracks: tracks.map((t) => ({
			...t,
			credits: trackCredits.filter((c) => c.recordingId === t.recording.id)
		}))
	};
}

export async function listArtists(db: Database, orgId: string) {
	return db
		.select({
			id: parties.id,
			name: parties.displayName,
			releases: sql<number>`count(distinct ${credits.releaseId})::int`,
			recordings: sql<number>`count(distinct ${credits.recordingId})::int`,
			remixes: sql<number>`count(*) filter (where ${credits.role} = 'remixer')::int`
		})
		.from(parties)
		.leftJoin(credits, eq(credits.partyId, parties.id))
		.where(eq(parties.orgId, orgId))
		.groupBy(parties.id)
		.orderBy(asc(sql`lower(${parties.displayName})`));
}

export async function getArtist(db: Database, orgId: string, id: string) {
	const [party] = await db
		.select()
		.from(parties)
		.where(and(eq(parties.orgId, orgId), eq(parties.id, id)));
	if (!party) return null;

	const asReleaseArtist = await db
		.select({
			id: releases.id,
			title: releases.title,
			type: releases.type,
			releaseDate: releases.releaseDate,
			catalogNumber: releases.catalogNumber
		})
		.from(credits)
		.innerJoin(releases, eq(releases.id, credits.releaseId))
		.where(and(eq(credits.partyId, id), isNotNull(credits.releaseId)))
		.orderBy(desc(releases.releaseDate));

	const onRecordings = await db
		.select({
			role: credits.role,
			recordingId: recordings.id,
			isrc: recordings.isrc,
			title: recordings.title,
			versionTitle: recordings.versionTitle,
			durationMs: recordings.durationMs
		})
		.from(credits)
		.innerJoin(recordings, eq(recordings.id, credits.recordingId))
		.where(and(eq(credits.partyId, id), isNotNull(credits.recordingId)))
		.orderBy(asc(credits.role), asc(recordings.title));

	return { party, releases: asReleaseArtist, credits: onRecordings };
}

export async function recentImports(db: Database, orgId: string) {
	return db
		.select()
		.from(importRuns)
		.where(eq(importRuns.orgId, orgId))
		.orderBy(desc(importRuns.createdAt))
		.limit(10);
}

export async function getRecording(db: Database, orgId: string, id: string) {
	const [recording] = await db
		.select()
		.from(recordings)
		.where(and(eq(recordings.orgId, orgId), eq(recordings.id, id)));
	if (!recording) return null;
	const onReleases = await db
		.select({
			id: releases.id,
			title: releases.title,
			releaseDate: releases.releaseDate,
			catalogNumber: releases.catalogNumber,
			position: releaseTracks.position
		})
		.from(releaseTracks)
		.innerJoin(releases, eq(releases.id, releaseTracks.releaseId))
		.where(eq(releaseTracks.recordingId, id))
		.orderBy(desc(releases.releaseDate));
	const recordingCredits = await db
		.select({
			id: credits.id,
			role: credits.role,
			position: credits.position,
			source: credits.source,
			approvedAt: credits.approvedAt,
			partyId: parties.id,
			name: parties.displayName
		})
		.from(credits)
		.innerJoin(parties, eq(parties.id, credits.partyId))
		.where(eq(credits.recordingId, id))
		.orderBy(asc(credits.role), asc(credits.position));
	return { recording, releases: onReleases, credits: recordingCredits };
}

export async function listLabels(db: Database, orgId: string) {
	return db
		.select({ id: labels.id, name: labels.name })
		.from(labels)
		.where(eq(labels.orgId, orgId))
		.orderBy(asc(labels.name));
}
