import { randomBytes, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { AudioProviderError, type AudioProvider } from './audio/provider';
import { providerResolver } from './audiokit-clients';
import {
	dueQueuedJobs,
	JobError,
	NO_READY_MASTER,
	queueJobForLatestMaster,
	submitQueuedJob
} from './audiokit-jobs';
import { audiokitJobs, auditLog, masters, memberships, orgs, recordings } from './db/schema';
import { asUser } from './db/scoped';
import { createTestDb } from './test-db';

/**
 * EPSILON-145: Run / Re-run writes the queued job (and its audit row) under RLS and returns; the
 * per-minute worker is what picks the job up and submits it to AudioKit.
 */

const manager = '00000000-0000-7000-8000-0000000145a1';
const viewer = '00000000-0000-7000-8000-0000000145a2';
const outsider = '00000000-0000-7000-8000-0000000145b1';

describe('queueing analysis from the recording page', () => {
	let db: Awaited<ReturnType<typeof createTestDb>>['db'];
	let orgId: string;
	let otherOrg: string;
	let recordingId: string;
	let bare: string;
	let older: string;
	let newest: string;

	const ctx = (userId = manager, role: 'catalog_manager' | 'viewer' = 'catalog_manager') => ({
		orgId,
		role,
		actor: { id: userId, kind: 'user' as const }
	});

	async function addMaster(recording: string, status: 'ready' | 'pending', createdAt: Date) {
		const id = randomUUID();
		await db.insert(masters).values({
			id,
			orgId,
			recordingId: recording,
			objectKey: `orgs/${orgId}/recordings/${recording}/masters/${id}.wav`,
			sizeBytes: 10,
			sha256: status === 'ready' ? 'a'.repeat(64) : null,
			fileName: 'invented.wav',
			status,
			createdAt,
			completedAt: status === 'ready' ? createdAt : null,
			uploadedBy: manager
		});
		return id;
	}

	async function addRecording(org: string, title: string) {
		const isrc = `XX${randomBytes(2).toString('hex').toUpperCase().slice(0, 3)}2614${title.length}`
			.padEnd(12, '5')
			.slice(0, 12);
		const [rec] = await db.insert(recordings).values({ orgId: org, isrc, title }).returning();
		return rec.id;
	}

	beforeAll(async () => {
		({ db } = await createTestDb());
		[{ id: orgId }] = await db.insert(orgs).values({ name: 'Label 145', slug: 'l145' }).returning();
		[{ id: otherOrg }] = await db
			.insert(orgs)
			.values({ name: 'Other 145', slug: 'o145' })
			.returning();
		await db.insert(memberships).values([
			{ orgId, userId: manager, role: 'catalog_manager' },
			{ orgId, userId: viewer, role: 'viewer' },
			{ orgId: otherOrg, userId: outsider, role: 'owner' }
		]);
		recordingId = await addRecording(orgId, 'Invented');
		bare = await addRecording(orgId, 'No master yet');
		older = await addMaster(recordingId, 'ready', new Date(Date.now() - 60_000));
		newest = await addMaster(recordingId, 'ready', new Date(Date.now() - 1_000));
		await addMaster(recordingId, 'pending', new Date()); // newer, but not ready
		await addMaster(bare, 'pending', new Date());
	});

	it('writes a queued job on the newest ready master, with its audit row, as the member', async () => {
		const result = await asUser(db, manager, (tx) =>
			queueJobForLatestMaster(tx, ctx(), recordingId, { operation: 'loudness' })
		);
		expect(result).toMatchObject({ status: 'queued', operation: 'loudness' });

		const [job] = await db.select().from(audiokitJobs).where(eq(audiokitJobs.id, result.jobId));
		expect(job).toMatchObject({
			orgId,
			recordingId,
			masterId: newest,
			operation: 'loudness',
			params: null,
			status: 'queued',
			requestedBy: manager,
			attempts: 0,
			providerJobId: null,
			submittedAt: null
		});
		expect(job.masterId).not.toBe(older);

		const audits = await db
			.select({ action: auditLog.action, actorId: auditLog.actorId, after: auditLog.after })
			.from(auditLog)
			.where(and(eq(auditLog.entity, 'audiokit_job'), eq(auditLog.entityId, result.jobId)));
		expect(audits).toEqual([
			{ action: 'queue', actorId: manager, after: { operation: 'loudness', status: 'queued' } }
		]);
	});

	it('stores validated params', async () => {
		const { jobId } = await asUser(db, manager, (tx) =>
			queueJobForLatestMaster(tx, ctx(), recordingId, {
				operation: 'stems',
				params: { model: 'htdemucs_ft' }
			})
		);
		const [job] = await db.select().from(audiokitJobs).where(eq(audiokitJobs.id, jobId));
		expect(job.params).toEqual({ model: 'htdemucs_ft' });
	});

	it('refuses a recording with no ready master, and one from another org, writing nothing', async () => {
		const before = (await db.select({ id: audiokitJobs.id }).from(audiokitJobs)).length;
		for (const [user, c, rec] of [
			[manager, ctx(), bare],
			[manager, ctx(), randomUUID()],
			// The outsider names this org's recording but is not a member: RLS hides the master.
			[outsider, { ...ctx(outsider), role: 'catalog_manager' as const }, recordingId]
		] as const) {
			await expect(
				asUser(db, user, (tx) => queueJobForLatestMaster(tx, c, rec, { operation: 'loudness' }))
			).rejects.toMatchObject({ status: 409, message: NO_READY_MASTER });
		}
		expect((await db.select({ id: audiokitJobs.id }).from(audiokitJobs)).length).toBe(before);
	});

	it('refuses a viewer and a bad request before touching the database', async () => {
		await expect(
			asUser(db, viewer, (tx) =>
				queueJobForLatestMaster(tx, ctx(viewer, 'viewer'), recordingId, { operation: 'loudness' })
			)
		).rejects.toBeInstanceOf(JobError);
		await expect(
			asUser(db, manager, (tx) =>
				queueJobForLatestMaster(tx, ctx(), recordingId, { operation: 'not-an-op' })
			)
		).rejects.toMatchObject({ status: 400 });
	});

	it('is picked up and submitted by the worker', async () => {
		const { jobId } = await asUser(db, manager, (tx) =>
			queueJobForLatestMaster(tx, ctx(), recordingId, { operation: 'probe' })
		);

		const due = await dueQueuedJobs(db, new Date(), 60_000, 100);
		expect(due.map((j) => j.id)).toContain(jobId);

		const submitted: { job_id: string; input: { url: string } }[] = [];
		const providerJobId = randomUUID();
		const provider = {
			submit: async (req: { job_id: string; input: { url: string } }) => {
				submitted.push(req);
				return { provider_job_id: providerJobId };
			}
		} as unknown as AudioProvider;
		const providers = providerResolver(
			db,
			{
				baseUrl: 'https://api.example',
				fallback: { apiKey: 'ak_fallback', webhookSecret: 'whsec_fallback', orgIds: [orgId] },
				credentialsKey: undefined
			},
			() => provider
		);
		const storage = {
			presignGet: async (key: string) => `https://r2.example/get/${key}`,
			presignPut: async (key: string) => `https://r2.example/put/${key}`
		};
		await submitQueuedJob(db, storage as never, providers, jobId, 'https://labelkit.example/x');

		expect(submitted.map((s) => s.job_id)).toEqual([jobId]);
		expect(submitted[0].input.url).toContain(`/masters/${newest}.wav`);
		const [job] = await db.select().from(audiokitJobs).where(eq(audiokitJobs.id, jobId));
		expect(job).toMatchObject({ status: 'submitted', providerJobId, attempts: 1 });
		expect((await dueQueuedJobs(db, new Date(), 60_000, 100)).map((j) => j.id)).not.toContain(
			jobId
		);
	});

	it('leaves a recently tried job for the next run', async () => {
		const { jobId } = await asUser(db, manager, (tx) =>
			queueJobForLatestMaster(tx, ctx(), recordingId, { operation: 'waveform' })
		);
		const now = new Date();
		await db
			.update(audiokitJobs)
			.set({ attempts: 1, lastAttemptAt: new Date(now.getTime() - 10_000) })
			.where(eq(audiokitJobs.id, jobId));
		expect((await dueQueuedJobs(db, now, 60_000, 100)).map((j) => j.id)).not.toContain(jobId);
		expect(
			(await dueQueuedJobs(db, new Date(now.getTime() + 60_000), 60_000, 100)).map((j) => j.id)
		).toContain(jobId);
	});
	// A-11: AudioKit checks every job against the client's plan. Labels' own clients are
	// unlimited, so this is defensive: a refusal fails that job once, with a clear reason.
	const refusingProviders = (error: Error) => {
		const calls: string[] = [];
		const provider = {
			submit: async (req: { job_id: string }) => {
				calls.push(req.job_id);
				throw error;
			}
		} as unknown as AudioProvider;
		const providers = providerResolver(
			db,
			{
				baseUrl: 'https://api.example',
				fallback: { apiKey: 'ak_fallback', webhookSecret: 'whsec_fallback', orgIds: [orgId] },
				credentialsKey: undefined
			},
			() => provider
		);
		return { calls, providers };
	};
	const storage = {
		presignGet: async (key: string) => `https://r2.example/get/${key}`,
		presignPut: async (key: string) => `https://r2.example/put/${key}`
	};

	it.each([
		['job_allowance_exhausted', 'probe', 'job allowance'],
		['stem_allowance_exhausted', 'stems', 'stem allowance'],
		['no_active_plan', 'probe', 'no active plan']
	] as const)(
		'fails a job AudioKit refuses with %s, without retrying it',
		async (code, op, says) => {
			const { jobId } = await asUser(db, manager, (tx) =>
				queueJobForLatestMaster(tx, ctx(), recordingId, { operation: op })
			);
			const { calls, providers } = refusingProviders(new AudioProviderError(code, 'over plan'));

			expect(
				await submitQueuedJob(db, storage as never, providers, jobId, 'https://labelkit.example/x')
			).toEqual({ status: 'failed', code });

			expect(calls).toEqual([jobId]);
			const [job] = await db.select().from(audiokitJobs).where(eq(audiokitJobs.id, jobId));
			expect(job).toMatchObject({ status: 'failed', attempts: 1, providerJobId: null });
			expect(job.finishedAt).not.toBeNull();
			expect(job.error).toMatchObject({ code, message: expect.stringContaining(says) });
			const audits = await db
				.select({ action: auditLog.action, after: auditLog.after })
				.from(auditLog)
				.where(and(eq(auditLog.entity, 'audiokit_job'), eq(auditLog.entityId, jobId)));
			expect(audits).toContainEqual({ action: 'refused', after: { status: 'failed', code } });
			// No longer queued, so the worker never picks it up again.
			const later = new Date(Date.now() + 3_600_000);
			expect((await dueQueuedJobs(db, later, 60_000, 100)).map((j) => j.id)).not.toContain(jobId);
		}
	);

	it('leaves a job queued for retry on other AudioKit errors', async () => {
		const { jobId } = await asUser(db, manager, (tx) =>
			queueJobForLatestMaster(tx, ctx(), recordingId, { operation: 'probe' })
		);
		for (const code of ['entitlement_unavailable', 'unavailable', 'constructor']) {
			const { providers } = refusingProviders(new AudioProviderError(code));
			await expect(
				submitQueuedJob(db, storage as never, providers, jobId, 'https://labelkit.example/x')
			).rejects.toMatchObject({ code });
		}
		const [job] = await db.select().from(audiokitJobs).where(eq(audiokitJobs.id, jobId));
		expect(job.status).toBe('queued');
	});
});
