import { readFileSync } from 'node:fs';
import { and, eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
	deleteMaster,
	keyInOrg,
	listMasters,
	type MasterCtx,
	MasterError,
	masterKey,
	signMasterParts,
	startMasterUpload
} from './masters';
import { queueAudioKitJob } from './audiokit-jobs';
import {
	leaseVerifications,
	MAX_ATTEMPTS,
	recordVerification,
	UNREADABLE,
	type VerifyResult
} from './master-verify';
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
	/** `sha256` is the hash of what R2 holds; the tests set it apart from what the upload claims. */
	objects = new Map<string, { size: number; start: Uint8Array; sha256: string }>();
	/** Set to make completeMultipart fail, as it does when R2 already completed the upload. */
	failComplete = false;
	/** Keys whose delete fails, as R2 might during an outage. */
	failRemove = new Set<string>();
	uploads = new Map<string, { key: string; completed?: Part[] }>();
	signed: string[] = [];
	removed: string[] = [];
	async presignPut(key: string) {
		this.signed.push(key);
		return `https://r2.test/${key}?X-Amz-Signature=x`;
	}
	async presignGet(key: string) {
		return `https://r2.test/${key}?X-Amz-Signature=get`;
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
		if (this.failComplete) throw new Error('NoSuchUpload');
		const u = this.uploads.get(uploadId);
		if (!u || u.key !== key) throw new Error('no such upload');
		u.completed = parts;
	}
	async abortMultipart(_key: string, uploadId: string) {
		this.uploads.delete(uploadId);
	}
	/** Set to answer as R2 does when the configured bucket does not exist (NoSuchBucket). */
	bucketMissing = false;
	async head(key: string) {
		const o = this.bucketMissing ? undefined : this.objects.get(key);
		return o ? { size: o.size } : null;
	}
	async isMissing(key: string) {
		return !this.bucketMissing && !this.objects.has(key);
	}
	async remove(key: string) {
		if (this.failRemove.has(key)) throw new Error('R2 delete failed');
		this.removed.push(key);
		this.objects.delete(key);
	}
	async list(prefix: string) {
		return [...this.objects.keys()].filter((k) => k.startsWith(prefix));
	}
	/** What the browser's PUT would do. */
	put(key: string, size: number, start = WAV, sha256 = SHA) {
		this.objects.set(key, { size, start, sha256 });
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

	/**
	 * What the background check would report for each leased master: a read of the fake object,
	 * or an error when this test's storage does not hold it (rows left by earlier tests).
	 */
	const readOf = (job: { id: string; token: string; url: string }): VerifyResult => {
		const key = new URL(job.url).pathname.slice(1);
		const o = storage.objects.get(key);
		if (!o) return { id: job.id, token: job.token, error: 'not found' };
		return {
			id: job.id,
			token: job.token,
			sha256: o.sha256,
			size: o.size,
			header: Buffer.from(o.start.slice(0, 12)).toString('hex')
		};
	};
	/**
	 * Run the background check once for the masters this test uploaded. Masters left `verifying`
	 * by earlier tests are leased but not reported, so their retries and rejections cannot touch
	 * this test's storage.
	 */
	const verifyNow = async () => {
		const outcomes: Record<string, string> = {};
		for (const job of await leaseVerifications(db, storage, { limit: 100 })) {
			if (!storage.objects.has(new URL(job.url).pathname.slice(1))) continue;
			outcomes[job.id] = await recordVerification(db, storage, readOf(job));
		}
		return outcomes;
	};

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

		it('only the owner connection can record a master as checked', async () => {
			// EPSILON-164: labelkit_app cannot write the server's hash or the completion time, so it
			// cannot mark a master ready either (masters_ready_complete needs both).
			const start = await asUser(db, ownerA, (tx) =>
				startMasterUpload(tx, storage, ctx(ownerA, 'owner'), recA, wav())
			);
			const id = start.masterId;
			await pgRefused(
				asUser(db, ownerA, (tx) =>
					tx.update(masters).set({ sha256: SHA }).where(eq(masters.id, id))
				)
			);
			await pgRefused(
				asUser(db, ownerA, (tx) =>
					tx.update(masters).set({ completedAt: new Date() }).where(eq(masters.id, id))
				)
			);
			await pgRefused(
				asUser(db, ownerA, (tx) =>
					tx
						.update(masters)
						.set({ status: 'ready', sha256: SHA, completedAt: new Date() })
						.where(eq(masters.id, id))
				)
			);
			expect(await keyOf(id)).toMatchObject({ status: 'pending', sha256: null, completedAt: null });

			// What uploads use is still allowed.
			await asUser(db, ownerA, (tx) =>
				tx
					.update(masters)
					.set({ status: 'verifying', claimedSha256: SHA, uploadId: null })
					.where(eq(masters.id, id))
			);
			expect(await keyOf(id)).toMatchObject({ status: 'verifying', claimedSha256: SHA });
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
			expect(res.status).toBe('verifying');
			expect((await verifyNow())[start.masterId]).toBe('rejected');
			expect(storage.removed).toEqual([objectKey]);
			const [reject] = await db
				.select({ after: auditLog.after })
				.from(auditLog)
				.where(and(eq(auditLog.entityId, start.masterId), eq(auditLog.action, 'upload_reject')));
			expect(reject.after).toEqual({
				status: 'rejected',
				reason: 'The uploaded file is not a WAV file.'
			});
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
			// Refused from the HEAD alone, without queueing a read.
			expect(res.status).toBe('rejected');
			expect(storage.objects.has(objectKey)).toBe(false);
			expect((await keyOf(start.masterId)).status).toBe('rejected');
		});

		it('rejects and deletes an upload whose stored bytes do not match the reported sha256', async () => {
			const start = await asUser(db, ownerA, (tx) =>
				startMasterUpload(tx, storage, ctx(ownerA, 'owner'), recA, wav(1000))
			);
			const { objectKey } = await keyOf(start.masterId);
			storage.put(objectKey, 1000, WAV, 'cd'.repeat(32));
			const res = await asUser(db, ownerA, (tx) =>
				completeMasterUpload(tx, storage, ctx(ownerA, 'owner'), start.masterId, { sha256: SHA })
			);
			expect(res.status).toBe('verifying');
			expect((await verifyNow())[start.masterId]).toBe('rejected');
			expect(storage.objects.has(objectKey)).toBe(false);
			const row = await keyOf(start.masterId);
			expect(row.status).toBe('rejected');
			expect(row.sha256).toBeNull();
			const [reject] = await db
				.select({ action: auditLog.action })
				.from(auditLog)
				.where(and(eq(auditLog.entityId, start.masterId), eq(auditLog.action, 'upload_reject')));
			expect(reject).toBeDefined();
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
		it('single PUT: verifying until the background check, then ready with the server hash', async () => {
			const start = await asUser(db, managerA, (tx) =>
				startMasterUpload(tx, storage, ctx(managerA, 'catalog_manager'), recA, wav(2048))
			);
			expect(start).toMatchObject({ mode: 'single', headers: { 'If-None-Match': '*' } });
			const { objectKey } = await keyOf(start.masterId);
			storage.put(objectKey, 2048);
			const res = await asUser(db, managerA, (tx) =>
				completeMasterUpload(tx, storage, ctx(managerA, 'catalog_manager'), start.masterId, {
					sha256: SHA
				})
			);
			expect(res.status).toBe('verifying');
			// The browser's hash is kept as a claim only; nothing is recorded as checked yet.
			expect(await keyOf(start.masterId)).toMatchObject({
				status: 'verifying',
				claimedSha256: SHA,
				sha256: null,
				completedAt: null
			});

			expect((await verifyNow())[start.masterId]).toBe('ready');
			const row = await keyOf(start.masterId);
			expect(row).toMatchObject({
				objectKey,
				sha256: SHA,
				sizeBytes: 2048,
				format: 'wav',
				status: 'ready',
				uploadedBy: managerA,
				verifyToken: null
			});
			expect(row.completedAt).toBeInstanceOf(Date);
			const trail = await db
				.select({ action: auditLog.action })
				.from(auditLog)
				.where(and(eq(auditLog.entity, 'master'), eq(auditLog.entityId, start.masterId)));
			expect(trail.map((t) => t.action).sort()).toEqual([
				'upload_complete',
				'upload_start',
				'upload_verified'
			]);

			await refused(
				asUser(db, managerA, (tx) =>
					completeMasterUpload(tx, storage, ctx(managerA, 'catalog_manager'), start.masterId, {
						sha256: SHA
					})
				),
				409
			);
		});

		/** Upload and complete a single-PUT master, leaving it `verifying`. */
		const startVerifying = async () => {
			const start = await asUser(db, ownerA, (tx) =>
				startMasterUpload(tx, storage, ctx(ownerA, 'owner'), recA, wav(2048))
			);
			const { objectKey } = await keyOf(start.masterId);
			storage.put(objectKey, 2048);
			await asUser(db, ownerA, (tx) =>
				completeMasterUpload(tx, storage, ctx(ownerA, 'owner'), start.masterId, { sha256: SHA })
			);
			return { id: start.masterId, objectKey };
		};
		/** Lease, with no backoff after a failed read unless one is given. */
		const leaseOf = async (id: string, leaseMs?: number, backoffSeconds = 0) =>
			(await leaseVerifications(db, storage, { limit: 100, leaseMs, backoffSeconds })).find(
				(j) => j.id === id
			);
		const rejection = async (id: string) =>
			(
				await db
					.select({ after: auditLog.after })
					.from(auditLog)
					.where(and(eq(auditLog.entityId, id), eq(auditLog.action, 'upload_reject')))
			)[0]?.after;

		it(`rejects a master whose read fails ${MAX_ATTEMPTS} times`, async () => {
			const { id, objectKey } = await startVerifying();
			for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt++) {
				const job = await leaseOf(id);
				expect(
					await recordVerification(db, storage, { id, token: job!.token, error: 'TimeoutError' })
				).toBe('retry');
				expect((await keyOf(id)).status).toBe('verifying');
			}
			const last = await leaseOf(id);
			expect(
				await recordVerification(db, storage, { id, token: last!.token, error: 'TimeoutError' })
			).toBe('rejected');
			expect(await keyOf(id)).toMatchObject({
				status: 'rejected',
				sha256: null,
				verifyAttempts: MAX_ATTEMPTS
			});
			expect(storage.objects.has(objectKey)).toBe(false);
			expect(await rejection(id)).toEqual({
				status: 'rejected',
				reason: UNREADABLE,
				attempts: MAX_ATTEMPTS
			});
			// Nothing is left to lease.
			expect(await leaseOf(id, 0)).toBeUndefined();
		});

		it('rejects a master whose last allowed read never reported back', async () => {
			const { id, objectKey } = await startVerifying();
			for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
				// Each lease runs out without a result, as when the function is killed.
				expect(await leaseOf(id, 0)).toBeDefined();
			}
			expect(await leaseOf(id, 0)).toBeUndefined();
			expect((await keyOf(id)).status).toBe('rejected');
			expect(storage.objects.has(objectKey)).toBe(false);
			expect(await rejection(id)).toMatchObject({ reason: UNREADABLE });
		});

		it('rejects at once when the stored object is gone, as R2 confirms (NoSuchKey)', async () => {
			const { id, objectKey } = await startVerifying();
			const job = await leaseOf(id);
			storage.objects.delete(objectKey);
			expect(
				await recordVerification(db, storage, {
					id,
					token: job!.token,
					error: 'Error: storage answered HTTP 404',
					status: 404
				})
			).toBe('rejected');
			expect(await keyOf(id)).toMatchObject({ status: 'rejected', verifyAttempts: 1 });
			expect(await rejection(id)).toEqual({ status: 'rejected', reason: UNREADABLE, attempts: 1 });
		});

		it("retries a reader's 404 when its own HEAD still finds the object", async () => {
			// R2 also answers 404 for a missing bucket: a misconfigured reader must not reject.
			const { id, objectKey } = await startVerifying();
			const job = await leaseOf(id);
			expect(
				await recordVerification(db, storage, {
					id,
					token: job!.token,
					error: 'Error: storage answered HTTP 404',
					status: 404
				})
			).toBe('retry');
			expect((await keyOf(id)).status).toBe('verifying');
			expect(storage.objects.has(objectKey)).toBe(true);
		});

		it('waits longer after each failed read before trying again', async () => {
			const { id } = await startVerifying();
			const first = await leaseOf(id, undefined, 60);
			const failed = new Date();
			expect(
				await recordVerification(db, storage, { id, token: first!.token, error: 'HTTP 503' })
			).toBe('retry');
			const row = await keyOf(id);
			// The lease ends, but the time of the failure is kept for the backoff.
			expect(row.verifyToken).toBeNull();
			expect(row.verifyStartedAt!.getTime()).toBeGreaterThanOrEqual(failed.getTime() - 5_000);
			// 2^1 minutes have not passed: not leased again, even with an expired-lease setting.
			expect(await leaseOf(id, 0, 60)).toBeUndefined();
			// Once the backoff has passed (here: none), it is.
			const again = await leaseOf(id, 0, 0);
			expect(again).toBeDefined();
			expect((await keyOf(id)).verifyAttempts).toBe(2);

			// The backoff doubles: after a second failure, 2^2 minutes. Pretend 3 have passed.
			await recordVerification(db, storage, { id, token: again!.token, error: 'HTTP 503' });
			await db
				.update(masters)
				.set({ verifyStartedAt: new Date(Date.now() - 3 * 60_000) })
				.where(eq(masters.id, id));
			expect(await leaseOf(id, 0, 60)).toBeUndefined();
			await db
				.update(masters)
				.set({ verifyStartedAt: new Date(Date.now() - 5 * 60_000) })
				.where(eq(masters.id, id));
			expect(await leaseOf(id, 0, 60)).toBeDefined();
		});

		it('an exhausted master whose file cannot be deleted does not block leasing', async () => {
			const stuck = await startVerifying();
			for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) await leaseOf(stuck.id, 0);
			storage.failRemove.add(stuck.objectKey);
			const error = vi.spyOn(console, 'error').mockImplementation(() => {});
			const other = await startVerifying();
			// The sweep fails for the stuck master, and leasing still goes ahead.
			expect(await leaseOf(other.id, 0)).toBeDefined();
			error.mockRestore();
			expect((await keyOf(stuck.id)).status).toBe('verifying');
			// Once the delete works, the next run rejects it.
			storage.failRemove.clear();
			await leaseOf(other.id, 0);
			expect((await keyOf(stuck.id)).status).toBe('rejected');
		});

		it('treats a 404 from a missing bucket as a failed read, not a gone object', async () => {
			// R2 answers 404 NoSuchBucket for a wrong R2_MASTERS_BUCKET: that must not reject.
			const { id, objectKey } = await startVerifying();
			const job = await leaseOf(id);
			storage.bucketMissing = true;
			expect(
				await recordVerification(db, storage, {
					id,
					token: job!.token,
					error: 'Error: storage answered HTTP 404',
					status: 404
				})
			).toBe('retry');
			expect(await keyOf(id)).toMatchObject({ status: 'verifying', sha256: null });
			expect(storage.objects.has(objectKey)).toBe(true);
			expect(await rejection(id)).toBeUndefined();
		});

		it('a whole batch whose cleanup fails does not starve the masters behind it', async () => {
			// Clear any exhausted masters earlier tests left, so the batch below is exactly ours.
			await leaseOf('none', 0);
			// Three masters whose 5th lease ran out without a result, a waiting longest.
			const exhaust = async (minutesAgo: number) => {
				const m = await startVerifying();
				await db
					.update(masters)
					.set({
						verifyAttempts: MAX_ATTEMPTS,
						verifyToken: crypto.randomUUID(),
						verifyStartedAt: new Date(Date.now() - minutesAgo * 60_000)
					})
					.where(eq(masters.id, m.id));
				return m;
			};
			const a = await exhaust(30);
			const b = await exhaust(29);
			const c = await exhaust(28);
			storage.failRemove.add(a.objectKey);
			storage.failRemove.add(b.objectKey);
			const error = vi.spyOn(console, 'error').mockImplementation(() => {});
			const sweep = () => leaseVerifications(db, storage, { limit: 2, leaseMs: 0 });
			// First run: the two longest-waiting (a, b) fail and go to the back of the queue.
			await sweep();
			expect((await keyOf(a.id)).status).toBe('verifying');
			expect((await keyOf(b.id)).status).toBe('verifying');
			// Next run reaches c, which is rejected although a and b still fail.
			await sweep();
			error.mockRestore();
			expect((await keyOf(c.id)).status).toBe('rejected');
			expect(storage.objects.has(c.objectKey)).toBe(false);
		});

		it('nothing uses a master while it is verifying', async () => {
			const start = await asUser(db, ownerA, (tx) =>
				startMasterUpload(tx, storage, ctx(ownerA, 'owner'), recA, wav(2048))
			);
			storage.put((await keyOf(start.masterId)).objectKey, 2048);
			await asUser(db, ownerA, (tx) =>
				completeMasterUpload(tx, storage, ctx(ownerA, 'owner'), start.masterId, { sha256: SHA })
			);
			const jobCtx = {
				orgId: orgA,
				role: 'owner' as const,
				actor: { id: ownerA, kind: 'user' as const }
			};
			const err = await asUser(db, ownerA, (tx) =>
				queueAudioKitJob(tx, jobCtx, recA, start.masterId, { operation: 'loudness' })
			).then(
				() => null,
				(e) => e
			);
			expect(err?.status).toBe(409);
		});

		it('leases a master once, ignores a stale result, and retries a failed or stalled check', async () => {
			const start = await asUser(db, ownerA, (tx) =>
				startMasterUpload(tx, storage, ctx(ownerA, 'owner'), recA, wav(2048))
			);
			const { objectKey } = await keyOf(start.masterId);
			storage.put(objectKey, 2048);
			await asUser(db, ownerA, (tx) =>
				completeMasterUpload(tx, storage, ctx(ownerA, 'owner'), start.masterId, { sha256: SHA })
			);
			const mine = <T extends { id: string }>(jobs: T[]) =>
				jobs.filter((j) => j.id === start.masterId);

			const [first] = mine(await leaseVerifications(db, storage, { limit: 100 }));
			expect(first).toBeDefined();
			// While the lease runs, the master is not handed out again.
			expect(mine(await leaseVerifications(db, storage, { limit: 100 }))).toEqual([]);

			// A check that crashed never reports; once its lease runs out the master is leased again.
			const [second] = mine(await leaseVerifications(db, storage, { limit: 100, leaseMs: 0 }));
			expect(second.token).not.toBe(first.token);
			expect((await keyOf(start.masterId)).verifyAttempts).toBe(2);

			// The first lease's late result changes nothing.
			expect(await recordVerification(db, storage, readOf(first))).toBe('stale');
			expect((await keyOf(start.masterId)).status).toBe('verifying');

			// A read that failed or hit its deadline ends the lease early; the master is not trusted.
			expect(
				await recordVerification(db, storage, {
					id: second.id,
					token: second.token,
					error: 'TimeoutError: The operation was aborted due to timeout'
				})
			).toBe('retry');
			expect(await keyOf(start.masterId)).toMatchObject({
				status: 'verifying',
				sha256: null,
				verifyToken: null
			});

			const [third] = mine(
				await leaseVerifications(db, storage, { limit: 100, backoffSeconds: 0 })
			);
			expect(await recordVerification(db, storage, readOf(third))).toBe('ready');
			expect((await keyOf(start.masterId)).sha256).toBe(SHA);
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
			expect(res.status).toBe('verifying');
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

		it('finishes a retried multipart completion when R2 already has the object', async () => {
			const size = MULTIPART_THRESHOLD + 1;
			const start = await asUser(db, ownerA, (tx) =>
				startMasterUpload(tx, storage, ctx(ownerA, 'owner'), recA, wav(size))
			);
			const { objectKey } = await keyOf(start.masterId);
			const parts = [1, 2].map((n) => ({ partNumber: n, etag: `"etag${n}"` }));
			storage.failComplete = true;
			// No object yet: the failure stands and the upload stays pending.
			await expect(
				asUser(db, ownerA, (tx) =>
					completeMasterUpload(tx, storage, ctx(ownerA, 'owner'), start.masterId, {
						sha256: SHA,
						parts
					})
				)
			).rejects.toThrow('NoSuchUpload');
			expect((await keyOf(start.masterId)).status).toBe('pending');
			// The object of the declared size is there: carry on.
			storage.put(objectKey, size);
			const res = await asUser(db, ownerA, (tx) =>
				completeMasterUpload(tx, storage, ctx(ownerA, 'owner'), start.masterId, {
					sha256: SHA,
					parts
				})
			);
			expect(res.status).toBe('verifying');
		});

		it('abort removes an object R2 already completed', async () => {
			const size = MULTIPART_THRESHOLD + 1;
			const start = await asUser(db, ownerA, (tx) =>
				startMasterUpload(tx, storage, ctx(ownerA, 'owner'), recA, wav(size))
			);
			const { objectKey } = await keyOf(start.masterId);
			storage.put(objectKey, size);
			await asUser(db, ownerA, (tx) =>
				abortMasterUpload(tx, storage, ctx(ownerA, 'owner'), start.masterId)
			);
			expect(storage.objects.has(objectKey)).toBe(false);
			expect((await keyOf(start.masterId)).status).toBe('aborted');
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

	describe('deleting a master', () => {
		/** Upload and complete a single-PUT master so it is ready to delete. */
		const startReady = async (userId: string, role: Role) => {
			const start = await asUser(db, userId, (tx) =>
				startMasterUpload(tx, storage, ctx(userId, role), recA, wav(2048))
			);
			const row = await keyOf(start.masterId);
			storage.put(row.objectKey, 2048);
			await asUser(db, userId, (tx) =>
				completeMasterUpload(tx, storage, ctx(userId, role), start.masterId, { sha256: SHA })
			);
			expect((await verifyNow())[start.masterId]).toBe('ready');
			return start.masterId;
		};

		const auditFor = (id: string) =>
			db
				.select({ action: auditLog.action, before: auditLog.before, after: auditLog.after })
				.from(auditLog)
				.where(and(eq(auditLog.entity, 'master'), eq(auditLog.entityId, id)));

		it.each([
			[viewerA, 'viewer'],
			[rightsA, 'rights_admin'],
			[agentA, 'agent']
		] as const)('refuses to delete a master for a %s (%s)', async (userId, role) => {
			const id = await startReady(ownerA, 'owner');
			const row = await keyOf(id);
			await refused(
				asUser(db, userId, (tx) => deleteMaster(tx, storage, ctx(userId, role), id)),
				403
			);
			expect(storage.removed).toEqual([]);
			expect((await keyOf(id))?.id).toBe(id);
			expect((await keyOf(id))?.objectKey).toBe(row.objectKey);
		});

		it.each([
			[ownerA, 'owner'],
			[managerA, 'catalog_manager']
		] as const)('lets a %s delete a ready master and audits it', async (userId, role) => {
			const id = await startReady(ownerA, 'owner');
			const row = await keyOf(id);
			const res = await asUser(db, userId, (tx) =>
				deleteMaster(tx, storage, ctx(userId, role), id)
			);
			expect(res).toEqual({ status: 'deleted', masterId: id });
			expect(storage.removed).toEqual([row.objectKey]);
			expect(storage.objects.has(row.objectKey)).toBe(false);
			expect(await keyOf(id)).toBeUndefined();

			const trail = await auditFor(id);
			const deleted = trail.find((t) => t.action === 'master_delete');
			expect(deleted?.before).toEqual({
				objectKey: row.objectKey,
				status: 'ready',
				sha256: SHA,
				sizeBytes: row.sizeBytes
			});
			expect(deleted?.after).toBeNull();
		});

		it("won't delete another org's master", async () => {
			const id = await startReady(ownerA, 'owner');
			const row = await keyOf(id);
			for (const orgId of [orgA, orgB]) {
				await refused(
					asUser(db, ownerB, (tx) => deleteMaster(tx, storage, ctx(ownerB, 'owner', orgId), id)),
					404
				);
			}
			expect(storage.removed).toEqual([]);
			expect((await keyOf(id))?.objectKey).toBe(row.objectKey);
		});

		it('aborts a pending multipart upload and removes its key', async () => {
			const start = await asUser(db, ownerA, (tx) =>
				startMasterUpload(tx, storage, ctx(ownerA, 'owner'), recA, wav(MULTIPART_THRESHOLD + 1))
			);
			const row = await keyOf(start.masterId);
			expect(row.uploadId).toBeTruthy();
			expect(storage.uploads.has(row.uploadId!)).toBe(true);
			await asUser(db, ownerA, (tx) =>
				deleteMaster(tx, storage, ctx(ownerA, 'owner'), start.masterId)
			);
			expect(storage.uploads.has(row.uploadId!)).toBe(false);
			// The key is removed too, in case R2 had already completed the upload.
			expect(storage.removed).toEqual([row.objectKey]);
			expect(await keyOf(start.masterId)).toBeUndefined();
		});

		it('removes the object for a pending single upload', async () => {
			const start = await asUser(db, ownerA, (tx) =>
				startMasterUpload(tx, storage, ctx(ownerA, 'owner'), recA, wav())
			);
			const row = await keyOf(start.masterId);
			expect(row.uploadId).toBeNull();
			await asUser(db, ownerA, (tx) =>
				deleteMaster(tx, storage, ctx(ownerA, 'owner'), start.masterId)
			);
			expect(storage.removed).toEqual([row.objectKey]);
			expect(await keyOf(start.masterId)).toBeUndefined();
		});

		it('returns 404 for an unknown or malformed master id', async () => {
			await refused(
				asUser(db, ownerA, (tx) => deleteMaster(tx, storage, ctx(ownerA, 'owner'), uuidv7())),
				404
			);
			await refused(
				asUser(db, ownerA, (tx) => deleteMaster(tx, storage, ctx(ownerA, 'owner'), 'not-a-uuid')),
				404
			);
			expect(storage.removed).toEqual([]);
		});

		it('the database removes nothing when a viewer deletes a master directly', async () => {
			const id = await startReady(ownerA, 'owner');
			await asUser(db, viewerA, (tx) => tx.delete(masters).where(eq(masters.id, id)));
			expect((await keyOf(id))?.id).toBe(id);
		});

		it('the database removes nothing when another org deletes a master directly', async () => {
			const id = await startReady(ownerA, 'owner');
			await asUser(db, ownerB, (tx) => tx.delete(masters).where(eq(masters.id, id)));
			expect((await keyOf(id))?.id).toBe(id);
		});
	});
});
