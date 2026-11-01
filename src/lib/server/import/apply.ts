import { and, eq, inArray } from 'drizzle-orm';
import { type Actor, type AuditRecord, type Database, withAudit } from '../audit';
import {
	credits,
	importRuns,
	labels,
	parties,
	recordings,
	releases,
	releaseTracks
} from '../db/schema';
import { uuidv7 } from '../db/uuidv7';
import { partyMatchKey } from './identifiers';
import { type ImportPlan, summarizePlan } from './symphonic';

export type ApplyResult = {
	dryRun: boolean;
	importRunId: string | null;
	counts: Record<
		'labels' | 'parties' | 'recordings' | 'releases' | 'tracks' | 'credits',
		{ created: number; updated: number; unchanged: number }
	>;
};

class DryRunRollback extends Error {
	constructor(readonly result: ApplyResult) {
		super('dry run');
	}
}

const CHUNK = 500;
async function insertChunked<T>(rows: T[], insert: (chunk: T[]) => Promise<unknown>) {
	for (let i = 0; i < rows.length; i += CHUNK) await insert(rows.slice(i, i + CHUNK));
}

const zero = () => ({ created: 0, updated: 0, unchanged: 0 });

/**
 * Write an import plan to the catalog. Idempotent: re-importing the same file changes nothing.
 * Additive: rows in the catalog that are not in the file are left alone.
 * Batched: a fixed handful of queries per table, whatever the file size, so it fits in a
 * serverless request far from the database.
 * Dry run: everything runs, then the transaction rolls back and only the counts come back.
 */
export async function applyImport(
	db: Database,
	plan: ImportPlan,
	ctx: { orgId: string; actor: Actor; fileName: string; fileSha256: string; dryRun: boolean }
): Promise<ApplyResult> {
	if (plan.issues.some((i) => i.level === 'error')) {
		throw new Error('applyImport: the plan has errors; fix the file first');
	}
	const { orgId } = ctx;
	const counts: ApplyResult['counts'] = {
		labels: zero(),
		parties: zero(),
		recordings: zero(),
		releases: zero(),
		tracks: zero(),
		credits: zero()
	};
	const now = new Date();

	try {
		return await withAudit(db, { orgId, actor: ctx.actor }, async (tx, audit) => {
			const entries: AuditRecord[] = [];

			// Labels
			const existingLabels = await tx.select().from(labels).where(eq(labels.orgId, orgId));
			const labelId = new Map(existingLabels.map((l) => [l.name, l.id]));
			const newLabels = plan.labels
				.filter((n) => !labelId.has(n))
				.map((name) => ({ id: uuidv7(), orgId, name }));
			if (newLabels.length) await tx.insert(labels).values(newLabels);
			for (const l of newLabels) {
				labelId.set(l.name, l.id);
				entries.push({ entity: 'label', entityId: l.id, action: 'import.create', after: l });
			}
			counts.labels = {
				created: newLabels.length,
				updated: 0,
				unchanged: plan.labels.length - newLabels.length
			};

			// Parties
			const existingParties = await tx.select().from(parties).where(eq(parties.orgId, orgId));
			const partyId = new Map(existingParties.map((p) => [p.matchKey, p.id]));
			const newParties = [...plan.parties]
				.filter(([key]) => !partyId.has(key))
				.map(([matchKey, displayName]) => ({ id: uuidv7(), orgId, matchKey, displayName }));
			await insertChunked(newParties, (c) => tx.insert(parties).values(c));
			for (const p of newParties) {
				partyId.set(p.matchKey, p.id);
				entries.push({ entity: 'party', entityId: p.id, action: 'import.create', after: p });
			}
			counts.parties = {
				created: newParties.length,
				updated: 0,
				unchanged: plan.parties.size - newParties.length
			};
			const pid = (name: string) => partyId.get(partyMatchKey(name))!;

			// Recordings
			const isrcs = [...plan.recordings.keys()];
			const existingRecs = isrcs.length
				? await tx
						.select()
						.from(recordings)
						.where(and(eq(recordings.orgId, orgId), inArray(recordings.isrc, isrcs)))
				: [];
			const recByIsrc = new Map(existingRecs.map((r) => [r.isrc, r]));
			const recId = new Map(existingRecs.map((r) => [r.isrc, r.id]));
			const newRecs = [];
			for (const r of plan.recordings.values()) {
				const fields = {
					title: r.title,
					versionTitle: r.versionTitle,
					durationMs: r.durationMs,
					genre: r.genre,
					subgenre: r.subgenre
				};
				const cur = recByIsrc.get(r.isrc);
				if (!cur) {
					const row = { id: uuidv7(), orgId, isrc: r.isrc, ...fields };
					newRecs.push(row);
					recId.set(r.isrc, row.id);
					entries.push({
						entity: 'recording',
						entityId: row.id,
						action: 'import.create',
						after: row
					});
					continue;
				}
				// Only fill or correct fields the file has a value for; never blank out data.
				const patch = Object.fromEntries(
					Object.entries(fields).filter(
						([k, v]) => v != null && v !== cur[k as keyof typeof fields]
					)
				);
				if (Object.keys(patch).length) {
					await tx
						.update(recordings)
						.set({ ...patch, updatedAt: now })
						.where(eq(recordings.id, cur.id));
					counts.recordings.updated++;
					entries.push({
						entity: 'recording',
						entityId: cur.id,
						action: 'import.update',
						before: Object.fromEntries(
							Object.keys(patch).map((k) => [k, cur[k as keyof typeof fields]])
						),
						after: patch
					});
				} else {
					counts.recordings.unchanged++;
				}
			}
			await insertChunked(newRecs, (c) => tx.insert(recordings).values(c));
			counts.recordings.created = newRecs.length;

			// Releases
			const upcs = [...plan.releases.keys()];
			const existingRels = upcs.length
				? await tx
						.select()
						.from(releases)
						.where(and(eq(releases.orgId, orgId), inArray(releases.upc, upcs)))
				: [];
			const relByUpc = new Map(existingRels.map((r) => [r.upc, r]));
			const relId = new Map(existingRels.map((r) => [r.upc, r.id]));
			const newRels = [];
			for (const r of plan.releases.values()) {
				const fields = {
					labelId: labelId.get(r.label)!,
					catalogNumber: r.catalogNumber,
					title: r.title,
					versionTitle: r.versionTitle,
					type: r.type,
					releaseDate: r.releaseDate,
					genre: r.genre,
					subgenre: r.subgenre
				};
				const cur = relByUpc.get(r.upc);
				if (!cur) {
					const row = { id: uuidv7(), orgId, upc: r.upc, ...fields };
					newRels.push(row);
					relId.set(r.upc, row.id);
					entries.push({
						entity: 'release',
						entityId: row.id,
						action: 'import.create',
						after: row
					});
					continue;
				}
				const patch = Object.fromEntries(
					Object.entries(fields).filter(
						([k, v]) => v != null && v !== cur[k as keyof typeof fields]
					)
				);
				if (Object.keys(patch).length) {
					await tx
						.update(releases)
						.set({ ...patch, updatedAt: now })
						.where(eq(releases.id, cur.id));
					counts.releases.updated++;
					entries.push({
						entity: 'release',
						entityId: cur.id,
						action: 'import.update',
						before: Object.fromEntries(
							Object.keys(patch).map((k) => [k, cur[k as keyof typeof fields]])
						),
						after: patch
					});
				} else {
					counts.releases.unchanged++;
				}
			}
			await insertChunked(newRels, (c) => tx.insert(releases).values(c));
			counts.releases.created = newRels.length;

			// Track lists: replace a release's list only when it differs from the file.
			const releaseIds = [...relId.values()];
			const existingTracks = releaseIds.length
				? await tx.select().from(releaseTracks).where(inArray(releaseTracks.releaseId, releaseIds))
				: [];
			const tracksByRelease = new Map<string, string>();
			for (const t of existingTracks.sort((a, b) => a.position - b.position)) {
				const prev = tracksByRelease.get(t.releaseId) ?? '';
				tracksByRelease.set(t.releaseId, `${prev}${t.disc}:${t.position}:${t.recordingId};`);
			}
			const toReplace: string[] = [];
			const trackRows = [];
			for (const r of plan.releases.values()) {
				const id = relId.get(r.upc)!;
				const desired = r.tracks.map((t) => ({
					releaseId: id,
					recordingId: recId.get(t.isrc)!,
					disc: 1,
					position: t.position
				}));
				const sig = desired.map((t) => `${t.disc}:${t.position}:${t.recordingId};`).join('');
				const current = tracksByRelease.get(id);
				if (current === sig) {
					counts.tracks.unchanged += desired.length;
					continue;
				}
				if (current) {
					toReplace.push(id);
					counts.tracks.updated += desired.length;
				} else {
					counts.tracks.created += desired.length;
				}
				trackRows.push(...desired);
				entries.push({
					entity: 'release',
					entityId: id,
					action: current ? 'import.tracklist_replace' : 'import.tracklist_create',
					after: r.tracks
				});
			}
			if (toReplace.length) {
				await tx.delete(releaseTracks).where(inArray(releaseTracks.releaseId, toReplace));
			}
			await insertChunked(trackRows, (c) => tx.insert(releaseTracks).values(c));

			// Credits: add missing ones; existing credits are never removed by an import.
			const existingCredits = await tx.select().from(credits).where(eq(credits.orgId, orgId));
			const creditKeys = new Set(
				existingCredits.map(
					(c) => `${c.recordingId ?? ''}|${c.releaseId ?? ''}|${c.partyId}|${c.role}`
				)
			);
			const newCredits = [];
			const approved = {
				source: 'symphonicms',
				approvedAt: now,
				approvedBy: `import:${ctx.actor.id}`
			};
			for (const r of plan.recordings.values()) {
				const recordingId = recId.get(r.isrc)!;
				for (const c of r.credits) {
					const partyIdValue = pid(c.name);
					const key = `${recordingId}||${partyIdValue}|${c.role}`;
					if (creditKeys.has(key)) {
						counts.credits.unchanged++;
						continue;
					}
					creditKeys.add(key);
					newCredits.push({
						id: uuidv7(),
						orgId,
						recordingId,
						releaseId: null,
						partyId: partyIdValue,
						role: c.role,
						position: c.position,
						...approved
					});
				}
			}
			for (const r of plan.releases.values()) {
				const releaseId = relId.get(r.upc)!;
				r.artists.forEach((name, position) => {
					const partyIdValue = pid(name);
					const key = `|${releaseId}|${partyIdValue}|main`;
					if (creditKeys.has(key)) {
						counts.credits.unchanged++;
						return;
					}
					creditKeys.add(key);
					newCredits.push({
						id: uuidv7(),
						orgId,
						recordingId: null,
						releaseId,
						partyId: partyIdValue,
						role: 'main' as const,
						position,
						...approved
					});
				});
			}
			await insertChunked(newCredits, (c) => tx.insert(credits).values(c));
			counts.credits.created = newCredits.length;
			for (const c of newCredits) {
				entries.push({ entity: 'credit', entityId: c.id, action: 'import.create', after: c });
			}

			// The run itself.
			const importRunId = uuidv7();
			const summary = { plan: summarizePlan(plan), counts };
			await tx.insert(importRuns).values({
				id: importRunId,
				orgId,
				source: 'symphonicms',
				fileName: ctx.fileName,
				fileSha256: ctx.fileSha256,
				actorId: ctx.actor.id,
				summary
			});
			entries.push({
				entity: 'import_run',
				entityId: importRunId,
				action: 'import.run',
				after: summary
			});
			await audit(entries);

			const result: ApplyResult = { dryRun: ctx.dryRun, importRunId, counts };
			if (ctx.dryRun) throw new DryRunRollback({ ...result, importRunId: null });
			return result;
		});
	} catch (e) {
		if (e instanceof DryRunRollback) return e.result;
		throw e;
	}
}
