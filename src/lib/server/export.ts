import { and, asc, eq } from 'drizzle-orm';
import type { Database } from '#lib/server/audit.js';
import {
	agreements,
	audiokitJobs,
	compositions,
	compositionWriters,
	consents,
	credits,
	labels,
	masters,
	parties,
	recordingCompositions,
	recordings,
	releases,
	releaseTracks,
	rightsShares
} from '#lib/server/db/schema.js';

/**
 * A label's whole catalogue as one JSON document, for owners leaving LabelKit or keeping a copy
 * (terms, section 7). Every row the label owns, by table, read through locals.db under RLS. Masters
 * are listed by id; the files themselves download one at a time from /org/export/masters/:id, so
 * no storage key or signed URL is written into the file.
 */
export const EXPORT_FORMAT = 'labelkit-catalogue-export';
export const EXPORT_VERSION = 1;

export async function exportCatalog(
	tx: Database,
	org: { id: string; name: string },
	now = new Date()
) {
	const byOrg = <T extends { orgId: unknown }>(table: T) => eq(table.orgId as never, org.id);
	const [
		labelRows,
		partyRows,
		recordingRows,
		releaseRows,
		trackRows,
		creditRows,
		compositionRows,
		recordingCompositionRows,
		writerRows,
		agreementRows,
		shareRows,
		consentRows,
		masterRows,
		jobRows
	] = await Promise.all([
		tx.select().from(labels).where(byOrg(labels)),
		tx.select().from(parties).where(byOrg(parties)),
		tx.select().from(recordings).where(byOrg(recordings)),
		tx.select().from(releases).where(byOrg(releases)),
		tx.select().from(releaseTracks).where(byOrg(releaseTracks)),
		tx.select().from(credits).where(byOrg(credits)),
		tx.select().from(compositions).where(byOrg(compositions)),
		tx.select().from(recordingCompositions).where(byOrg(recordingCompositions)),
		tx.select().from(compositionWriters).where(byOrg(compositionWriters)),
		tx.select().from(agreements).where(byOrg(agreements)),
		tx.select().from(rightsShares).where(byOrg(rightsShares)),
		tx.select().from(consents).where(byOrg(consents)),
		tx
			.select({
				id: masters.id,
				recordingId: masters.recordingId,
				fileName: masters.fileName,
				format: masters.format,
				sizeBytes: masters.sizeBytes,
				sha256: masters.sha256,
				status: masters.status,
				createdAt: masters.createdAt,
				completedAt: masters.completedAt
			})
			.from(masters)
			.where(and(eq(masters.orgId, org.id), eq(masters.status, 'ready')))
			.orderBy(asc(masters.createdAt)),
		tx
			.select({
				id: audiokitJobs.id,
				recordingId: audiokitJobs.recordingId,
				masterId: audiokitJobs.masterId,
				operation: audiokitJobs.operation,
				status: audiokitJobs.status,
				result: audiokitJobs.result,
				requestedAt: audiokitJobs.requestedAt,
				finishedAt: audiokitJobs.finishedAt
			})
			.from(audiokitJobs)
			.where(and(eq(audiokitJobs.orgId, org.id), eq(audiokitJobs.status, 'succeeded')))
	]);

	return {
		format: EXPORT_FORMAT,
		version: EXPORT_VERSION,
		exportedAt: now.toISOString(),
		label: { id: org.id, name: org.name },
		tables: {
			labels: labelRows,
			parties: partyRows,
			recordings: recordingRows,
			releases: releaseRows,
			releaseTracks: trackRows,
			credits: creditRows,
			compositions: compositionRows,
			recordingCompositions: recordingCompositionRows,
			compositionWriters: writerRows,
			agreements: agreementRows,
			rightsShares: shareRows,
			consents: consentRows,
			masters: masterRows,
			analysis: jobRows
		}
	};
}

/** File name for the download, e.g. epsilon-records-catalogue-2026-11-11.json. */
export function exportFileName(labelName: string, now = new Date()): string {
	const safe =
		labelName
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '') || 'label';
	return `${safe}-catalogue-${now.toISOString().slice(0, 10)}.json`;
}
