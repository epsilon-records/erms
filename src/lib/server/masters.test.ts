import { readFileSync } from 'node:fs';
import { and, eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { isWavHeader, MULTIPART_THRESHOLD, PART_SIZE, wavProblem } from '../masters';
import { auditLog, masters, memberships, orgs, recordings, type Role } from './db/schema';
import { asUser } from './db/scoped';
import { uuidv7 } from './db/uuidv7';
import { applyImport } from './import/apply';
import { parseSymphonicInventory } from './import/symphonic';
import {
	abortMasterUpload,
	canUploadMasters,
	completeMasterUpload,
	keyInOrg,
	listMasters,
	type MasterCtx,
	MasterError,
	masterKey,
	signMasterParts,
	startMasterUpload
} from './masters';
import type { MasterStorage, Part } from './storage/r2';
import { createTestDb } from './test-db';

const SAMPLE = readFileSync(
	new URL('./import/__fixtures__/symphonic-sample.csv', import.meta.url),
	'utf8'
);

const ownerA = '00000000-0000-7000-8000-00000000000a';
const managerA = '00000000-0000-7000-8000-0000000000a1';
const viewerA = '00000000-0000-7000-8000-0000000000a2';
const rightsA = '00000000-0000-7000-8000-0000000000a3';
const agentA = '00000000-0000-7000-8000-0000000000a4';
const ownerB = '00000000-0000-7000-8000-00000000000b';

const WAV = new TextEncoder().encode('RIFF\x24\x00\x00\x00WAVEfmt ');
const MP3 = new TextEncoder().encode('ID3\x04\x00\x00\x00\x00\x00\x00\x00\x00');
const SHA = 'ab'.repeat(32);

/** In-memory stand-in for R2 that records which keys it was asked to sign. */
class FakeStorage implements MasterStorage {
	objects = new Map<string, { size: number; start: Uint8Array }>();
	uploads = new Map<string, { key: string; completed?: Part[] }>();
	signed: string[] = [];
	removed: string[] = [];
	async presignPut(key: string) {
		this.signed.push(key);
		return `https://r2.test/${key}?X-Amz-Signature=x`;
	}
	async createMultipart(key: string) {
		const id = `upload-${this.uploads.size + 1}`;
		this.uploads.set(id, { key });
		return id;
	}
	async presignPart(key: string, uploadId: string, n: number) {
		this.signed.push(key);
		return `https://r2.test/${key}?partNumber=${n}&uploadId=${uploadId}`;
	}
	async completeMultipart(key: string, uploadId: string, parts: Part[]) {
		const u = this.uploads.get(uploadId);
		if (!u || u.key !== key) throw new Error('no such upload');
		u.completed = parts;
	}
	async abortMultipart(_key: string, uploadId: string) {
		this.uploads.delete(uploadId);
	}
	async head(key: string) {
		const o = this.objects.get(key);
		return o ? { size: o.size } : null;
	}
	async readStart(key: string, length: number) {
		return (this.objects.get(key)?.start ?? new Uint8Array()).slice(0, length);
	}
	async remove(key: string) {
		this.removed.push(key);
		this.objects.delete(key);
	}
	/** What the browser's PUT would do. */
	put(key: string, size: number, start = WAV) {
		this.objects.set(key, { size, start });
	}
}

async function refused(p: Promise<unknown>, status: number) {
	const err = await p.then(
		() => null,
		(e) => e
	);
	expect(err, `expected a ${status}`).toBeInstanceOf(MasterError);
	expect((err as MasterError).status).toBe(status);
	return err as MasterError;
}

async function pgRefused(p: Promise<unknown>) {
	const err = await p.then(
		() => null,
		(e) => e
	);
	expect(err, 'expected the database to refuse').not.toBeNull();
}

describe('master uploads', () => {
	let db: Awaited<ReturnType<typeof createTestDb>>['db'];
	let orgA: string;
	let orgB: string;
	let recA: string;
	let recB: string;
	let storage: FakeStorage;

	const ctx = (userId: string, role: Role, orgId = orgA): MasterCtx => ({
		orgId,
		role,
		actor: { id: userId, kind: 'user' }
	});
	const wav = (size = 1000, fileName = 'Master.wav') => ({
		fileName,
		size,
		contentType: 'audio/wav'
	});
	const keyOf = async (id: string) =>
		(await db.select().from(masters).where(eq(masters.id, id)))[0];

	beforeAll(async () => {
		({ db } = await createTestDb());
		[{ id: orgA }] = await db.insert(orgs).values({ name: 'Label A', slug: 'a' }).returning();
		[{ id: orgB }] = await db.insert(orgs).values({ name: 'Label B', slug: 'b' }).returning();
		await db.insert(memberships).values([
			{ orgId: orgA, userId: ownerA, role: 'owner' },
			{ orgId: orgA, userId: managerA, role: 'catalog_manager' },
			{ orgId: orgA, userId: viewerA, role: 'viewer' },
			{ orgId: orgA, userId: rightsA, role: 'rights_admin' },
			{ orgId: orgA, userId: agentA, role: 'agent' },
			{ orgId: orgB, userId: ownerB, role: 'owner' }
		]);
		const plan = parseSymphonicInventory(SAMPLE);
		for (const [orgId, userId] of [
			[orgA, ownerA],
			[orgB, ownerB]
		]) {
			await asUser(db, userId, (tx) =>
				applyImport(tx, plan, {
					orgId,
					actor: { id: userId, kind: 'user' },
					fileName: 'sample.csv',
					fileSha256: 'a'.repeat(64),
					dryRun: false
				})
			);
		}
		[{ id: recA }] = await db.select().from(recordings).where(eq(recordings.orgId, orgA)).limit(1);
		[{ id: recB }] = await db.select().from(recordings).where(eq(recordings.orgId, orgB)).limit(1);
	});

	beforeEach(() => {
		storage = new FakeStorage();
	});

	describe('role check', () => {
		it('only roles with catalog:write can upload', () => {
			expect(canUploadMasters('owner')).toBe(true);
			expect(canUploadMasters('catalog_manager')).toBe(true);
			expect(canUploadMasters('viewer')).toBe(false);
			expect(canUploadMasters('rights_admin')).toBe(false);
			expect(canUploadMasters('agent')).toBe(false);
		});

		it.each([
			[viewerA, 'viewer'],
			[rightsA, 'rights_admin'],
			[agentA, 'agent']
		] as const)('refuses to sign anything for a %s (%s)', async (userId, role) => {
			await refused(
				asUser(db, userId, (tx) => startMasterUpload(tx, storage, ctx(userId, role), recA, wav())),
				403
			);
			expect(storage.signed).toEqual([]);
			expect(storage.uploads.size).toBe(0);
		});

		it('lets owners and catalog managers start an upload', async () => {
			for (const [userId, role] of [
				[ownerA, 'owner'],
				[managerA, 'catalog_manager']
			] as const) {
				const res = await asUser(db, userId, (tx) =>
					startMasterUpload(tx, storage, ctx(userId, role), recA, wav())
				);
				expect(res.mode).toBe('single');
			}
			expect(storage.signed).toHaveLength(2);
		});

		it('the database refuses a master from a viewer even if the app check is skipped', async () => {
			const id = uuidv7();
			await pgRefused(
				asUser(db, viewerA, (tx) =>
					tx.insert(masters).values({
						id,
						orgId: orgA,
						recordingId: recA,
						objectKey: masterKey(orgA, recA, id),
						sizeBytes: 1,
						fileName: 'x.wav',
						uploadedBy: viewerA
					})
				)
			);
		});

		it('refuses part signing, completion and abort for a viewer', async () => {
			const start = await asUser(db, ownerA, (tx) =>
				startMasterUpload(tx, storage, ctx(ownerA, 'owner'), recA, wav())
			);
			const as = ctx(viewerA, 'viewer');
			await refused(
				asUser(db, viewerA, (tx) =>
					signMasterParts(tx, storage, as, start.masterId, { partNumbers: [1] })
				),
				403
			);
			await refused(
				asUser(db, viewerA, (tx) =>
					completeMasterUpload(tx, storage, as, start.masterId, { sha256: SHA })
				),
				403
			);
			await refused(
				asUser(db, viewerA, (tx) => abortMasterUpload(tx, storage, as, start.masterId)),
				403
			);
		});
	});

	describe('org scoping of keys', () => {
		it('builds keys under the org, recording and master id', async () => {
			const res = await asUser(db, ownerA, (tx) =>
				startMasterUpload(tx, storage, ctx(ownerA, 'owner'), recA, wav())
			);
			const row = await keyOf(res.masterId);
			expect(row.objectKey).toBe(`orgs/${orgA}/recordings/${recA}/masters/${res.masterId}.wav`);
			expect(storage.signed).toEqual([row.objectKey]);
			expect(res.mode === 'single' && res.url).toContain(row.objectKey);
		});

		it('ignores any key or org the request tries to supply', async () => {
			const res = await asUser(db, ownerA, (tx) =>
				startMasterUpload(tx, storage, ctx(ownerA, 'owner'), recA, {
					...wav(),
					objectKey: `orgs/${orgB}/evil.wav`,
					orgId: orgB
				})
			);
			expect(keyInOrg((await keyOf(res.masterId)).objectKey, orgA)).toBe(true);
		});

		it("won't sign for another org's recording", async () => {
			await refused(
				asUser(db, ownerA, (tx) =>
					startMasterUpload(tx, storage, ctx(ownerA, 'owner'), recB, wav())
				),
				404
			);
			// Even with a forged context naming org B, RLS hides B's recording from A's owner.
			await refused(
				asUser(db, ownerA, (tx) =>
					startMasterUpload(tx, storage, ctx(ownerA, 'owner', orgB), recB, wav())
				),
				404
			);
			expect(storage.signed).toEqual([]);
		});

		it("won't sign parts for, complete or abort another org's upload", async () => {
			const start = await asUser(db, ownerA, (tx) =>
				startMasterUpload(tx, storage, ctx(ownerA, 'owner'), recA, wav(MULTIPART_THRESHOLD + 1))
			);
			storage.signed = [];
			for (const orgId of [orgB, orgA]) {
				const as = ctx(ownerB, 'owner', orgId);
				await refused(
					asUser(db, ownerB, (tx) =>
						signMasterParts(tx, storage, as, start.masterId, { partNumbers: [1] })
					),
					404
				);
				await refused(
					asUser(db, ownerB, (tx) =>
						completeMasterUpload(tx, storage, as, start.masterId, { sha256: SHA })
					),
					404
				);
				await refused(
					asUser(db, ownerB, (tx) => abortMasterUpload(tx, storage, as, start.masterId)),
					404
				);
			}
			expect(storage.signed).toEqual([]);
			expect((await keyOf(start.masterId)).status).toBe('pending');
		});

		it("the database refuses a key outside the row's org", async () => {
			const id = uuidv7();
			await pgRefused(
				asUser(db, ownerA, (tx) =>
					tx.insert(masters).values({
						id,
						orgId: orgA,
						recordingId: recA,
						objectKey: `orgs/${orgB}/recordings/${recA}/masters/${id}.wav`,
						sizeBytes: 1,
						fileName: 'x.wav',
						uploadedBy: ownerA
					})
				)
			);
		});

		it('the key, org and size cannot be changed after signing', async () => {
			const start = await asUser(db, ownerA, (tx) =>
				startMasterUpload(tx, storage, ctx(ownerA, 'owner'), recA, wav())
			);
			await pgRefused(
				asUser(db, ownerA, (tx) =>
					tx
						.update(masters)
						.set({ objectKey: `orgs/${orgA}/other.wav` })
						.where(eq(masters.id, start.masterId))
				)
			);
			await pgRefused(
				asUser(db, ownerA, (tx) =>
					tx.update(masters).set({ sizeBytes: 5 }).where(eq(masters.id, start.masterId))
				)
			);
		});

		it('another org cannot read the master rows', async () => {
			await asUser(db, ownerA, (tx) =>
				startMasterUpload(tx, storage, ctx(ownerA, 'owner'), recA, wav())
			);
			const seen = await asUser(db, ownerB, (tx) => listMasters(tx, orgA, recA));
			expect(seen).toEqual([]);
			const own = await asUser(db, viewerA, (tx) => listMasters(tx, orgA, recA));
			expect(own.length).toBeGreaterThan(0);
		});

		it('keyInOrg and masterKey reject anything outside the org', () => {
			expect(keyInOrg(`orgs/${orgA}/recordings/x.wav`, orgA)).toBe(true);
			expect(keyInOrg(`orgs/${orgB}/recordings/x.wav`, orgA)).toBe(false);
			expect(keyInOrg(`orgs/${orgA}/../${orgB}/x.wav`, orgA)).toBe(false);
			expect(keyInOrg(`orgs/${orgA}x/a.wav`, orgA)).toBe(false);
			expect(() => masterKey(orgA, '../x', uuidv7())).toThrow(MasterError);
		});
	});

	describe('rejecting non-WAV uploads', () => {
		it.each([
			[{ fileName: 'Master.mp3', size: 1000, contentType: '' }],
			[{ fileName: 'Master.wav', size: 1000, contentType: 'audio/mpeg' }],
			[{ fileName: 'Master.flac', size: 1000, contentType: 'audio/flac' }],
			[{ fileName: 'Master.wav.exe', size: 1000, contentType: '' }]
		])('refuses to sign %o', async (input) => {
			const before = (await db.select().from(masters)).length;
			await refused(
				asUser(db, ownerA, (tx) =>
					startMasterUpload(tx, storage, ctx(ownerA, 'owner'), recA, input)
				),
				422
			);
			expect(storage.signed).toEqual([]);
			expect((await db.select().from(masters)).length).toBe(before);
		});

		it('refuses files over 4 GiB and empty files', async () => {
			for (const size of [4 * 1024 ** 3 + 1, 0]) {
				const err = await asUser(db, ownerA, (tx) =>
					startMasterUpload(tx, storage, ctx(ownerA, 'owner'), recA, wav(size))
				).catch((e) => e);
				expect(err).toBeInstanceOf(MasterError);
			}
		});

		it('rejects and deletes an upload whose bytes are not WAV', async () => {
			const start = await asUser(db, ownerA, (tx) =>
				startMasterUpload(tx, storage, ctx(ownerA, 'owner'), recA, wav(1000))
			);
			const { objectKey } = await keyOf(start.masterId);
			storage.put(objectKey, 1000, MP3);
			const res = await asUser(db, ownerA, (tx) =>
				completeMasterUpload(tx, storage, ctx(ownerA, 'owner'), start.masterId, { sha256: SHA })
			);
			expect(res).toEqual({ status: 'rejected', reason: 'The uploaded file is not a WAV file.' });
			expect(storage.removed).toEqual([objectKey]);
			const row = await keyOf(start.masterId);
			expect(row.status).toBe('rejected');
			expect(row.sha256).toBeNull();
		});

		it('rejects an upload whose size differs from what was declared', async () => {
			const start = await asUser(db, ownerA, (tx) =>
				startMasterUpload(tx, storage, ctx(ownerA, 'owner'), recA, wav(1000))
			);
			const { objectKey } = await keyOf(start.masterId);
			storage.put(objectKey, 999);
			const res = await asUser(db, ownerA, (tx) =>
				completeMasterUpload(tx, storage, ctx(ownerA, 'owner'), start.masterId, { sha256: SHA })
			);
			expect(res.status).toBe('rejected');
			expect(storage.objects.has(objectKey)).toBe(false);
		});

		it('recognises WAV headers and file names', () => {
			expect(isWavHeader(WAV)).toBe(true);
			const rf64 = new TextEncoder().encode('RF64\x00\x00\x00\x00WAVE');
			rf64.fill(0xff, 4, 8);
			expect(isWavHeader(rf64)).toBe(true);
			expect(isWavHeader(MP3)).toBe(false);
			expect(isWavHeader(new TextEncoder().encode('RIFF\x00\x00\x00\x00AVI '))).toBe(false);
			expect(isWavHeader(new Uint8Array(4))).toBe(false);
			expect(wavProblem({ name: 'a.WAV', size: 1, type: 'audio/x-wav' })).toBeNull();
			expect(wavProblem({ name: 'a.wav', size: 1, type: '' })).toBeNull();
			expect(wavProblem({ name: 'a.aiff', size: 1, type: 'audio/aiff' })).not.toBeNull();
		});
	});

	describe('recording the master', () => {
		it('single PUT: records key, sha256, size and format, with an audit trail', async () => {
			const start = await asUser(db, managerA, (tx) =>
				startMasterUpload(tx, storage, ctx(managerA, 'catalog_manager'), recA, wav(2048))
			);
			expect(start.mode).toBe('single');
			const { objectKey } = await keyOf(start.masterId);
			storage.put(objectKey, 2048);
			const res = await asUser(db, managerA, (tx) =>
				completeMasterUpload(tx, storage, ctx(managerA, 'catalog_manager'), start.masterId, {
					sha256: SHA
				})
			);
			expect(res.status).toBe('ready');
			const row = await keyOf(start.masterId);
			expect(row).toMatchObject({
				objectKey,
				sha256: SHA,
				sizeBytes: 2048,
				format: 'wav',
				status: 'ready',
				uploadedBy: managerA
			});
			expect(row.completedAt).toBeInstanceOf(Date);
			const trail = await db
				.select({ action: auditLog.action })
				.from(auditLog)
				.where(and(eq(auditLog.entity, 'master'), eq(auditLog.entityId, start.masterId)));
			expect(trail.map((t) => t.action).sort()).toEqual(['upload_complete', 'upload_start']);

			await refused(
				asUser(db, managerA, (tx) =>
					completeMasterUpload(tx, storage, ctx(managerA, 'catalog_manager'), start.masterId, {
						sha256: SHA
					})
				),
				409
			);
		});

		it('multipart: signs parts within range and needs every part to complete', async () => {
			const size = 2 * PART_SIZE + 10;
			const start = await asUser(db, ownerA, (tx) =>
				startMasterUpload(tx, storage, ctx(ownerA, 'owner'), recA, wav(size))
			);
			expect(start).toMatchObject({ mode: 'multipart', partSize: PART_SIZE, partCount: 3 });
			const { objectKey, uploadId } = await keyOf(start.masterId);
			expect(uploadId).toBeTruthy();
			const as = ctx(ownerA, 'owner');

			const signed = await asUser(db, ownerA, (tx) =>
				signMasterParts(tx, storage, as, start.masterId, { partNumbers: [1, 2, 3] })
			);
			expect(signed.parts.map((p) => p.partNumber)).toEqual([1, 2, 3]);
			await refused(
				asUser(db, ownerA, (tx) =>
					signMasterParts(tx, storage, as, start.masterId, { partNumbers: [4] })
				),
				400
			);

			const parts = [1, 2, 3].map((n) => ({ partNumber: n, etag: `"etag${n}"` }));
			await refused(
				asUser(db, ownerA, (tx) =>
					completeMasterUpload(tx, storage, as, start.masterId, {
						sha256: SHA,
						parts: parts.slice(0, 2)
					})
				),
				400
			);

			storage.put(objectKey, size);
			const res = await asUser(db, ownerA, (tx) =>
				completeMasterUpload(tx, storage, as, start.masterId, {
					sha256: SHA,
					parts: [...parts].reverse()
				})
			);
			expect(res.status).toBe('ready');
			expect(storage.uploads.get(uploadId!)?.completed).toEqual(parts);
			const row = await keyOf(start.masterId);
			expect(row.uploadId).toBeNull();
			expect(row.sizeBytes).toBe(size);
		});

		it('refuses part URLs for a single-PUT upload and a bad sha256', async () => {
			const start = await asUser(db, ownerA, (tx) =>
				startMasterUpload(tx, storage, ctx(ownerA, 'owner'), recA, wav())
			);
			await refused(
				asUser(db, ownerA, (tx) =>
					signMasterParts(tx, storage, ctx(ownerA, 'owner'), start.masterId, {
						partNumbers: [1]
					})
				),
				409
			);
			await refused(
				asUser(db, ownerA, (tx) =>
					completeMasterUpload(tx, storage, ctx(ownerA, 'owner'), start.masterId, {
						sha256: 'not-a-hash'
					})
				),
				400
			);
		});

		it('keeps an upload pending until R2 has the object', async () => {
			const start = await asUser(db, ownerA, (tx) =>
				startMasterUpload(tx, storage, ctx(ownerA, 'owner'), recA, wav())
			);
			await refused(
				asUser(db, ownerA, (tx) =>
					completeMasterUpload(tx, storage, ctx(ownerA, 'owner'), start.masterId, { sha256: SHA })
				),
				409
			);
			expect((await keyOf(start.masterId)).status).toBe('pending');
		});

		it('abort cancels the multipart upload', async () => {
			const start = await asUser(db, ownerA, (tx) =>
				startMasterUpload(tx, storage, ctx(ownerA, 'owner'), recA, wav(MULTIPART_THRESHOLD + 1))
			);
			const { uploadId } = await keyOf(start.masterId);
			await asUser(db, ownerA, (tx) =>
				abortMasterUpload(tx, storage, ctx(ownerA, 'owner'), start.masterId)
			);
			expect(storage.uploads.has(uploadId!)).toBe(false);
			expect((await keyOf(start.masterId)).status).toBe('aborted');
		});
	});
});
