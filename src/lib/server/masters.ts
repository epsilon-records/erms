import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
	MAX_MASTER_BYTES,
	MULTIPART_THRESHOLD,
	PART_SIZE,
	partCount,
	WAV_CONTENT_TYPES,
	wavProblem
} from '../masters';
import { type Actor, type Database, withAudit } from './audit';
import { type Master, masters, type Role, recordings } from './db/schema';
import { uuidv7 } from './db/uuidv7';
import { hasScope } from './rbac';
import { CREATE_ONCE_HEADERS, type MasterStorage, type Part } from './storage/r2';

/**
 * Master uploads (EPSILON-29, decision 0011). The browser sends the file straight to R2
 * with URLs signed here; this module decides who may upload, where the object goes,
 * and what ERMS records about it once R2 has it.
 *
 * Org isolation: object keys are built here from the caller's org and never taken from
 * the request, and the masters_key_in_org check ties each key to its row's org. RLS
 * then limits rows (and so keys we will sign for) to orgs the user belongs to.
 */

export type MasterCtx = { orgId: string; role: Role; actor: Actor };

/** A refused request, with the HTTP status the route should answer with. */
export class MasterError extends Error {
	constructor(
		readonly status: 400 | 403 | 404 | 409 | 422,
		message: string
	) {
		super(message);
	}
}

/** Presigned URLs are short-lived: long enough to start a part, not to be reused later. */
export const URL_TTL_SECONDS = 15 * 60;
/** Most part URLs one request may ask for. */
export const MAX_PARTS_PER_REQUEST = 16;

export function canUploadMasters(role: Role) {
	return hasScope(role, 'catalog:write');
}

function assertCanUpload(ctx: MasterCtx) {
	if (!canUploadMasters(ctx.role)) {
		throw new MasterError(403, `Your role (${ctx.role}) cannot upload masters.`);
	}
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The only place object keys are made. */
export function masterKey(orgId: string, recordingId: string, masterId: string) {
	for (const id of [orgId, recordingId, masterId]) {
		if (!UUID.test(id)) throw new MasterError(400, 'Invalid id');
	}
	return `orgs/${orgId}/recordings/${recordingId}/masters/${masterId}.wav`;
}

/** True if `key` is inside `orgId`'s part of the bucket. */
export function keyInOrg(key: string, orgId: string) {
	return UUID.test(orgId) && key.startsWith(`orgs/${orgId}/`) && !key.includes('..');
}

export const StartUpload = z.object({
	fileName: z.string().trim().min(1).max(255),
	size: z.number().int().positive().max(MAX_MASTER_BYTES),
	contentType: z
		.union([z.literal(''), z.enum(WAV_CONTENT_TYPES)])
		.optional()
		.default('')
});

export type StartResult =
	| { masterId: string; mode: 'single'; url: string; headers: Record<string, string> }
	| { masterId: string; mode: 'multipart'; partSize: number; partCount: number };

function parseStart(input: unknown) {
	const parsed = StartUpload.safeParse(input);
	if (!parsed.success) {
		const typeIssue = parsed.error.issues.some((i) => i.path[0] === 'contentType');
		throw new MasterError(
			typeIssue ? 422 : 400,
			typeIssue ? 'Masters must be WAV files.' : 'Invalid upload request.'
		);
	}
	const problem = wavProblem({
		name: parsed.data.fileName,
		size: parsed.data.size,
		type: parsed.data.contentType
	});
	if (problem) throw new MasterError(422, problem);
	return parsed.data;
}

/** Record a pending master and sign the URL(s) the browser uploads it with. */
export async function startMasterUpload(
	db: Database,
	storage: MasterStorage,
	ctx: MasterCtx,
	recordingId: string,
	input: unknown
): Promise<StartResult> {
	assertCanUpload(ctx);
	const req = parseStart(input);
	if (!UUID.test(recordingId)) throw new MasterError(404, 'Recording not found');

	return withAudit(db, ctx, async (tx, audit) => {
		const [rec] = await tx
			.select({ id: recordings.id })
			.from(recordings)
			.where(and(eq(recordings.orgId, ctx.orgId), eq(recordings.id, recordingId)));
		if (!rec) throw new MasterError(404, 'Recording not found');

		const id = uuidv7();
		const objectKey = masterKey(ctx.orgId, recordingId, id);
		const multipart = req.size > MULTIPART_THRESHOLD;
		const uploadId = multipart ? await storage.createMultipart(objectKey) : null;
		const [row] = await tx
			.insert(masters)
			.values({
				id,
				orgId: ctx.orgId,
				recordingId,
				objectKey,
				format: 'wav',
				sizeBytes: req.size,
				fileName: req.fileName,
				status: 'pending',
				uploadId,
				uploadedBy: ctx.actor.id
			})
			.returning();
		await audit({ entity: 'master', entityId: id, action: 'upload_start', after: row });

		if (uploadId) {
			return {
				masterId: id,
				mode: 'multipart',
				partSize: PART_SIZE,
				partCount: partCount(req.size)
			};
		}
		return {
			masterId: id,
			mode: 'single',
			url: await storage.presignPut(objectKey, URL_TTL_SECONDS),
			// Signed into the URL: the browser must send them as they are.
			headers: { ...CREATE_ONCE_HEADERS }
		};
	});
}

/** A pending master in the caller's org. RLS limits it to orgs the user belongs to too. */
async function pendingMaster(db: Database, ctx: MasterCtx, masterId: string, lock = false) {
	if (!UUID.test(masterId)) throw new MasterError(404, 'Upload not found');
	const q = db
		.select()
		.from(masters)
		.where(and(eq(masters.orgId, ctx.orgId), eq(masters.id, masterId)));
	const [row] = lock ? await q.for('update') : await q;
	if (!row) throw new MasterError(404, 'Upload not found');
	if (row.status !== 'pending') throw new MasterError(409, `This upload is already ${row.status}.`);
	// Defence in depth: the database check already ties the key to the org.
	if (!keyInOrg(row.objectKey, ctx.orgId)) throw new MasterError(403, 'Upload not in this org');
	return row;
}

/** Sign PUT URLs for some parts of a multipart upload. */
export async function signMasterParts(
	db: Database,
	storage: MasterStorage,
	ctx: MasterCtx,
	masterId: string,
	input: unknown
) {
	assertCanUpload(ctx);
	const parsed = z
		.object({
			partNumbers: z.array(z.number().int().positive()).min(1).max(MAX_PARTS_PER_REQUEST)
		})
		.safeParse(input);
	if (!parsed.success) throw new MasterError(400, 'Invalid part numbers.');
	const row = await pendingMaster(db, ctx, masterId);
	if (!row.uploadId) throw new MasterError(409, 'This upload is not multipart.');
	const total = partCount(row.sizeBytes);
	if (parsed.data.partNumbers.some((n) => n > total)) {
		throw new MasterError(400, `This upload has ${total} parts.`);
	}
	return {
		parts: await Promise.all(
			parsed.data.partNumbers.map(async (partNumber) => ({
				partNumber,
				url: await storage.presignPart(row.objectKey, row.uploadId!, partNumber, URL_TTL_SECONDS)
			}))
		)
	};
}

const Complete = z.object({
	sha256: z.string().regex(/^[0-9a-f]{64}$/, 'sha256 must be 64 hex characters'),
	parts: z
		.array(
			z.object({
				partNumber: z.number().int().positive(),
				etag: z.string().regex(/^"?[A-Za-z0-9-]{1,128}"?$/)
			})
		)
		.optional()
});

export type CompleteResult =
	{ status: 'verifying'; master: Master } | { status: 'rejected'; reason: string };

/**
 * Finish an upload. Completes the multipart upload, then does only the cheap check here: R2 has
 * an object of the declared size. A wrong size is rejected without reading the file. Otherwise the
 * master becomes `verifying`, with the SHA-256 the browser reported kept as `claimedSha256`, and a
 * background step (master-verify.ts) reads the object, checks the WAV header and its own SHA-256,
 * and sets it to `ready` or rejects it (EPSILON-120). Until then nothing uses the master.
 */
export async function completeMasterUpload(
	db: Database,
	storage: MasterStorage,
	ctx: MasterCtx,
	masterId: string,
	input: unknown
): Promise<CompleteResult> {
	assertCanUpload(ctx);
	const parsed = Complete.safeParse(input);
	if (!parsed.success) throw new MasterError(400, 'Invalid completion request.');
	const { sha256: claimed, parts } = parsed.data;

	return withAudit(db, ctx, async (tx, audit) => {
		const row = await pendingMaster(tx, ctx, masterId, true);

		if (row.uploadId) {
			const total = partCount(row.sizeBytes);
			const sorted: Part[] = [...(parts ?? [])].sort((a, b) => a.partNumber - b.partNumber);
			if (sorted.length !== total || sorted.some((p, i) => p.partNumber !== i + 1)) {
				throw new MasterError(400, `Send all ${total} parts, numbered 1 to ${total}.`);
			}
			try {
				await storage.completeMultipart(row.objectKey, row.uploadId, sorted);
			} catch (e) {
				// A retry after R2 already completed the upload: the upload id is gone, but the object is
				// there. Carry on if it has the declared size; the background check reads it either way.
				const there = await storage.head(row.objectKey);
				if (there?.size !== row.sizeBytes) throw e;
			}
		}

		const head = await storage.head(row.objectKey);
		if (!head) throw new MasterError(409, 'The file has not arrived in storage yet.');

		if (head.size !== row.sizeBytes) {
			const reason = `Stored file is ${head.size} bytes, expected ${row.sizeBytes}.`;
			await storage.remove(row.objectKey);
			await tx
				.update(masters)
				.set({ status: 'rejected', uploadId: null })
				.where(eq(masters.id, row.id));
			await audit({
				entity: 'master',
				entityId: row.id,
				action: 'upload_reject',
				before: { status: 'pending' },
				after: { status: 'rejected', reason }
			});
			return { status: 'rejected' as const, reason };
		}

		const [updated] = await tx
			.update(masters)
			.set({ status: 'verifying', claimedSha256: claimed, uploadId: null })
			.where(eq(masters.id, row.id))
			.returning();
		await audit({
			entity: 'master',
			entityId: row.id,
			action: 'upload_complete',
			before: { status: 'pending' },
			after: { status: 'verifying', claimedSha256: claimed, sizeBytes: head.size }
		});
		return { status: 'verifying' as const, master: updated };
	});
}

/** Cancel a pending upload and drop whatever R2 already has of it. */
export async function abortMasterUpload(
	db: Database,
	storage: MasterStorage,
	ctx: MasterCtx,
	masterId: string
) {
	assertCanUpload(ctx);
	return withAudit(db, ctx, async (tx, audit) => {
		const row = await pendingMaster(tx, ctx, masterId, true);
		// A multipart upload R2 already completed has no upload id left to abort, so the object is
		// removed as well. Removing a key that is not there is harmless.
		if (row.uploadId) await storage.abortMultipart(row.objectKey, row.uploadId);
		await storage.remove(row.objectKey);
		await tx
			.update(masters)
			.set({ status: 'aborted', uploadId: null })
			.where(eq(masters.id, row.id));
		await audit({
			entity: 'master',
			entityId: row.id,
			action: 'upload_abort',
			before: { status: 'pending' },
			after: { status: 'aborted' }
		});
		return { status: 'aborted' as const };
	});
}

/**
 * Delete a master (EPSILON-55): drop its R2 object and its row in one audited transaction.
 * The role check is the same as an upload's. A pending multipart upload is aborted first;
 * anything else is removed. The row carries its own org, so RLS scoping is the database's
 * masters_catalog_delete policy plus the org filter here.
 */
export async function deleteMaster(
	db: Database,
	storage: MasterStorage,
	ctx: MasterCtx,
	masterId: string
) {
	assertCanUpload(ctx);
	return withAudit(db, ctx, async (tx, audit) => {
		if (!UUID.test(masterId)) throw new MasterError(404, 'Master not found');
		const [row] = await tx
			.select()
			.from(masters)
			.where(and(eq(masters.orgId, ctx.orgId), eq(masters.id, masterId)))
			.for('update');
		if (!row) throw new MasterError(404, 'Master not found');
		// Defence in depth: the database check already ties the key to the org.
		if (!keyInOrg(row.objectKey, ctx.orgId)) throw new MasterError(403, 'Master not in this org');

		// Abort an unfinished multipart upload, and remove the object either way: R2 may already
		// have completed the upload.
		if (row.status === 'pending' && row.uploadId) {
			await storage.abortMultipart(row.objectKey, row.uploadId);
		}
		await storage.remove(row.objectKey);

		await tx.delete(masters).where(eq(masters.id, row.id));
		await audit({
			entity: 'master',
			entityId: row.id,
			action: 'master_delete',
			before: {
				objectKey: row.objectKey,
				status: row.status,
				sha256: row.sha256,
				sizeBytes: row.sizeBytes
			},
			after: null
		});
		return { status: 'deleted' as const, masterId: row.id };
	});
}

/** Masters for a recording, newest first. */
export function listMasters(db: Database, orgId: string, recordingId: string) {
	return db
		.select({
			id: masters.id,
			fileName: masters.fileName,
			format: masters.format,
			sizeBytes: masters.sizeBytes,
			sha256: masters.sha256,
			status: masters.status,
			objectKey: masters.objectKey,
			createdAt: masters.createdAt,
			completedAt: masters.completedAt
		})
		.from(masters)
		.where(and(eq(masters.orgId, orgId), eq(masters.recordingId, recordingId)))
		.orderBy(desc(masters.createdAt));
}
