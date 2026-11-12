import { randomBytes, randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { LabelClientsBilling } from './audio/billing';
import type { AudioProvider } from './audio/provider';
import {
	advanceLabelClients,
	credentialsForClient,
	issueLabelClient,
	LabelClientError,
	providerResolver,
	rotateLabelClient,
	submissionCredentials
} from './audiokit-clients';
import { parseKeyRing } from './audiokit-credentials';
import { reconcileJobs, submitQueuedJob, webhookUrlFor } from './audiokit-jobs';
import {
	audiokitJobs,
	audiokitLabelClients,
	auditLog,
	masters,
	memberships,
	orgs,
	recordings
} from './db/schema';
import { asUser } from './db/scoped';
import { createTestDb } from './test-db';

const ownerA = '00000000-0000-7000-8000-00000000000a';
const viewerA = '00000000-0000-7000-8000-0000000000a2';
const KEY_ENV = `k1:${randomBytes(32).toString('base64')}`;
const ring = parseKeyRing(KEY_ENV);
const FALLBACK = { apiKey: 'ak_fallback_key', webhookSecret: 'whsec_fallback' };

/** A billing double that hands out numbered clients and remembers what was asked of it. */
function fakeBilling(opts: { httpStatus?: 201 | 202; syncState?: string } = {}) {
	const state = new Map<string, string>(); // client id -> sync_state
	let n = 0;
	const issue = async (orgId: string) => {
		const clientId = randomUUID();
		const sync = opts.syncState ?? 'synced';
		state.set(clientId, sync);
		n++;
		return {
			httpStatus: opts.httpStatus ?? 201,
			label_client: {
				client_id: clientId,
				erms_org_id: orgId,
				status: 'active',
				key_prefix: `ak_n${n}`,
				sync_state: sync
			},
			credentials: { api_key: `ak_issued_${n}_${clientId}`, webhook_secret: `whsec_issued_${n}` }
		};
	};
	const fake = {
		issue: vi.fn(issue),
		rotate: vi.fn(issue),
		get: vi.fn(async (clientId: string) => ({
			client_id: clientId,
			erms_org_id: 'x',
			status: 'active',
			sync_state: state.get(clientId) as 'synced'
		})),
		revoke: vi.fn(async (clientId: string) => {
			state.set(clientId, 'revoked');
			return {
				client_id: clientId,
				erms_org_id: 'x',
				status: 'revoked',
				sync_state: 'revoked' as const
			};
		}),
		state
	};
	return fake as typeof fake & LabelClientsBilling;
}

describe('per-label AudioKit clients', () => {
	let db: Awaited<ReturnType<typeof createTestDb>>['db'];

	/** A fresh org with an owner and a viewer. */
	async function newOrg(slug: string) {
		const [{ id }] = await db
			.insert(orgs)
			.values({ name: `Label ${slug}`, slug })
			.returning();
		await db.insert(memberships).values([
			{ orgId: id, userId: ownerA, role: 'owner' },
			{ orgId: id, userId: viewerA, role: 'viewer' }
		]);
		return id;
	}

	/** A queued job for a ready master in the org. */
	async function newJob(orgId: string, n: number) {
		const [rec] = await db
			.insert(recordings)
			.values({
				orgId,
				isrc: `XX${randomBytes(2).toString('hex').toUpperCase().slice(0, 3)}2600${String(n).padStart(3, '0')}`.slice(
					0,
					12
				),
				title: `Invented ${n}`
			})
			.returning();
		const masterId = randomUUID();
		await db.insert(masters).values({
			id: masterId,
			orgId,
			recordingId: rec.id,
			objectKey: `orgs/${orgId}/recordings/${rec.id}/masters/${masterId}.wav`,
			sizeBytes: 10,
			sha256: 'a'.repeat(64),
			fileName: 'invented.wav',
			status: 'ready',
			completedAt: new Date(),
			uploadedBy: ownerA
		});
		const [job] = await db
			.insert(audiokitJobs)
			.values({ orgId, recordingId: rec.id, masterId, operation: 'probe', requestedBy: ownerA })
			.returning();
		return job;
	}

	beforeAll(async () => {
		({ db } = await createTestDb());
	});

	const env = (credentialsKey: string | undefined = KEY_ENV) => ({
		baseUrl: 'https://api.example',
		fallback: FALLBACK,
		credentialsKey
	});

	it('stores an issued client sealed, makes it active, and audits it without the secrets', async () => {
		const orgId = await newOrg('issue');
		const billing = fakeBilling();
		const out = await issueLabelClient(db, billing, ring, {
			orgId,
			actor: { id: ownerA, kind: 'user' }
		});
		expect(out.status).toBe('active');

		const [row] = await db
			.select()
			.from(audiokitLabelClients)
			.where(eq(audiokitLabelClients.orgId, orgId));
		expect(row.status).toBe('active');
		const dump = JSON.stringify(row);
		expect(dump).not.toContain('ak_issued_1');
		expect(dump).not.toContain('whsec_issued_1');

		const creds = await credentialsForClient(db, () => ring, out.clientId);
		expect(creds).toMatchObject({ clientId: out.clientId, orgId, webhookSecret: 'whsec_issued_1' });
		expect(creds?.apiKey).toBe(`ak_issued_1_${out.clientId}`);

		const audit = await db.select().from(auditLog).where(eq(auditLog.orgId, orgId));
		expect(audit.map((a) => a.action)).toEqual(['issue_client']);
		expect(JSON.stringify(audit)).not.toMatch(/ak_issued|whsec_issued/);
	});

	it('refuses a second first client, and a rotation with no active client', async () => {
		const orgId = await newOrg('twice');
		const admin = { orgId, actor: { id: ownerA, kind: 'user' as const } };
		const billing = fakeBilling();
		await expect(rotateLabelClient(db, billing, ring, admin)).rejects.toMatchObject({
			status: 409
		});
		await issueLabelClient(db, billing, ring, admin);
		await expect(issueLabelClient(db, billing, ring, admin)).rejects.toBeInstanceOf(
			LabelClientError
		);
		expect(billing.issue).toHaveBeenCalledTimes(1);
	});

	it('keeps a client pending while billing has not synced it, and uses the fallback meanwhile', async () => {
		const orgId = await newOrg('pending');
		const billing = fakeBilling({ httpStatus: 202, syncState: 'pending_sync' });
		const out = await issueLabelClient(db, billing, ring, {
			orgId,
			actor: { id: ownerA, kind: 'user' }
		});
		expect(out.status).toBe('pending');
		const listed = { ...FALLBACK, orgIds: [orgId] };
		expect((await submissionCredentials(db, () => ring, orgId, listed)).clientId).toBeNull();
		expect(await credentialsForClient(db, () => ring, out.clientId)).toBeNull();

		// Billing has not caught up: nothing moves. Once it has, the client becomes the active one.
		expect(await advanceLabelClients(db, billing)).toMatchObject({ activated: 0 });
		billing.state.set(out.clientId, 'synced');
		expect(await advanceLabelClients(db, billing)).toMatchObject({ activated: 1 });
		expect((await submissionCredentials(db, () => ring, orgId, FALLBACK)).clientId).toBe(
			out.clientId
		);
	});

	it('gives each org its own key, and the fallback only to a listed org with no client', async () => {
		const [a, b, none] = [await newOrg('own-a'), await newOrg('own-b'), await newOrg('own-none')];
		const billing = fakeBilling();
		const ca = await issueLabelClient(db, billing, ring, {
			orgId: a,
			actor: { id: ownerA, kind: 'user' }
		});
		const cb = await issueLabelClient(db, billing, ring, {
			orgId: b,
			actor: { id: ownerA, kind: 'user' }
		});

		const credsA = await submissionCredentials(db, () => ring, a, FALLBACK);
		const credsB = await submissionCredentials(db, () => ring, b, FALLBACK);
		expect(credsA.clientId).toBe(ca.clientId);
		expect(credsB.clientId).toBe(cb.clientId);
		expect(credsA.apiKey).not.toBe(credsB.apiKey);
		expect(credsA.apiKey).not.toBe(FALLBACK.apiKey);
		expect(
			await submissionCredentials(db, () => ring, none, { ...FALLBACK, orgIds: [none] })
		).toEqual({ clientId: null, apiKey: FALLBACK.apiKey, webhookSecret: FALLBACK.webhookSecret });
		await expect(
			submissionCredentials(db, () => ring, none, { orgIds: [none] })
		).rejects.toMatchObject({ status: 503 });
	});

	it('fails closed for an unlisted org with no client instead of using the fallback (EPSILON-135)', async () => {
		const [listed, unlisted] = [await newOrg('fb-listed'), await newOrg('fb-unlisted')];
		const fallback = { ...FALLBACK, orgIds: [listed] };
		expect((await submissionCredentials(db, () => ring, listed, fallback)).clientId).toBeNull();
		await expect(submissionCredentials(db, () => ring, unlisted, fallback)).rejects.toMatchObject({
			status: 409
		});
		// Unset list: no org may use the fallback.
		await expect(submissionCredentials(db, () => ring, listed, FALLBACK)).rejects.toMatchObject({
			status: 409
		});
	});

	it('fails closed for a label whose client was revoked instead of using the fallback', async () => {
		const orgId = await newOrg('revoked');
		const out = await issueLabelClient(db, fakeBilling(), ring, {
			orgId,
			actor: { id: ownerA, kind: 'user' }
		});
		await db
			.update(audiokitLabelClients)
			.set({ status: 'revoked', apiKeySealed: null, webhookSecretSealed: null })
			.where(eq(audiokitLabelClients.clientId, out.clientId));
		await expect(submissionCredentials(db, () => ring, orgId, FALLBACK)).rejects.toMatchObject({
			status: 409
		});
		expect(await credentialsForClient(db, () => ring, out.clientId)).toBeNull();
	});

	it('rotates: both clients verify while rotating, new jobs use the new one, the old one retires when idle', async () => {
		const orgId = await newOrg('rotate');
		const admin = { orgId, actor: { id: ownerA, kind: 'user' as const } };
		const billing = fakeBilling();
		const first = await issueLabelClient(db, billing, ring, admin);
		const job = await newJob(orgId, 1);
		await db
			.update(audiokitJobs)
			.set({
				clientId: first.clientId,
				status: 'submitted',
				providerJobId: randomUUID(),
				submittedAt: new Date()
			})
			.where(eq(audiokitJobs.id, job.id));

		const second = await rotateLabelClient(db, billing, ring, admin);
		expect(second.status).toBe('active');
		// One rotation at a time: a third client has to wait until the first is retired.
		await expect(rotateLabelClient(db, billing, ring, admin)).rejects.toMatchObject({
			status: 409
		});
		expect((await submissionCredentials(db, () => ring, orgId, FALLBACK)).clientId).toBe(
			second.clientId
		);

		// The first client is draining but still opens, so its job's webhook still verifies.
		expect(await credentialsForClient(db, () => ring, first.clientId)).not.toBeNull();
		expect(await credentialsForClient(db, () => ring, second.clientId)).not.toBeNull();

		// An unfinished job keeps its client from being revoked...
		await advanceLabelClients(db, billing);
		expect(billing.revoke).not.toHaveBeenCalledWith(first.clientId);
		expect(await credentialsForClient(db, () => ring, first.clientId)).not.toBeNull();

		// ...and once it is done the client is revoked and its credentials are wiped.
		await db
			.update(audiokitJobs)
			.set({ status: 'canceled', finishedAt: new Date() })
			.where(eq(audiokitJobs.id, job.id));
		await advanceLabelClients(db, billing);
		expect(billing.revoke).toHaveBeenCalledWith(first.clientId);
		expect(await credentialsForClient(db, () => ring, first.clientId)).toBeNull();
		const [old] = await db
			.select()
			.from(audiokitLabelClients)
			.where(eq(audiokitLabelClients.clientId, first.clientId));
		expect(old).toMatchObject({ status: 'revoked', apiKeySealed: null, webhookSecretSealed: null });
	});

	it('serializes issue per org: two at once call billing once', async () => {
		const orgId = await newOrg('race');
		const billing = fakeBilling();
		const admin = { orgId, actor: { id: ownerA, kind: 'user' as const } };
		const results = await Promise.allSettled([
			issueLabelClient(db, billing, ring, admin),
			issueLabelClient(db, billing, ring, admin)
		]);
		expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
		expect(billing.issue).toHaveBeenCalledTimes(1);
		const rows = await db
			.select()
			.from(audiokitLabelClients)
			.where(eq(audiokitLabelClients.orgId, orgId));
		expect(rows).toHaveLength(1);
	});

	it('revokes the client again when its credentials could not be stored, and surfaces the original failure', async () => {
		const orgId = await newOrg('lost');
		const taken = await issueLabelClient(db, fakeBilling(), ring, {
			orgId: await newOrg('lost-other'),
			actor: { id: ownerA, kind: 'user' }
		});
		// Billing answers with a client id ERMS already holds, so the write is refused.
		const clash = fakeBilling();
		const real = clash.issue.getMockImplementation() as (
			o: string
		) => ReturnType<typeof clash.issue>;
		clash.issue.mockImplementation((async (o: string) => {
			const issued = await real(o);
			return { ...issued, label_client: { ...issued.label_client, client_id: taken.clientId } };
		}) as never);
		await expect(
			issueLabelClient(db, clash, ring, { orgId, actor: { id: ownerA, kind: 'user' } })
		).rejects.not.toBeInstanceOf(LabelClientError);
		expect(clash.revoke).toHaveBeenCalledWith(taken.clientId);
		const rows = await db
			.select()
			.from(audiokitLabelClients)
			.where(eq(audiokitLabelClients.orgId, orgId));
		expect(rows).toHaveLength(0);
	});

	it('refuses a row where the secrets and the status disagree', async () => {
		const orgId = await newOrg('check');
		await expect(
			db
				.insert(audiokitLabelClients)
				.values({ orgId, clientId: randomUUID(), status: 'active', syncState: 'synced' })
		).rejects.toThrow();
	});

	it('submits each job under its own org client, stamps it, and polls with the same key', async () => {
		const [a, b, none] = [await newOrg('job-a'), await newOrg('job-b'), await newOrg('job-none')];
		const billing = fakeBilling();
		const ca = await issueLabelClient(db, billing, ring, {
			orgId: a,
			actor: { id: ownerA, kind: 'user' }
		});
		const cb = await issueLabelClient(db, billing, ring, {
			orgId: b,
			actor: { id: ownerA, kind: 'user' }
		});
		const jobs = [await newJob(a, 10), await newJob(b, 11), await newJob(none, 12)];

		const seen: { key: string; hook: string | undefined }[] = [];
		const polled: string[] = [];
		const factory = (key: string): AudioProvider =>
			({
				submit: async (req: { webhook?: { url: string } }) => {
					seen.push({ key, hook: req.webhook?.url });
					return { provider_job_id: randomUUID() };
				},
				status: async () => {
					polled.push(key);
					return { status: 'running' };
				}
			}) as unknown as AudioProvider;
		// `none` has no client of its own and is allowed the fallback (EPSILON-135).
		const listedEnv = { ...env(), fallback: { ...FALLBACK, orgIds: [none] } };
		const providers = providerResolver(db, listedEnv, factory);
		const storage = {
			presignGet: async () => 'https://r2.example/get',
			presignPut: async () => 'https://r2.example/put'
		};

		for (const j of jobs)
			await submitQueuedJob(db, storage as never, providers, j.id, 'https://erms.example/x');

		const stamped = await db
			.select({ id: audiokitJobs.id, clientId: audiokitJobs.clientId })
			.from(audiokitJobs);
		const byId = new Map(stamped.map((r) => [r.id, r.clientId]));
		expect(byId.get(jobs[0].id)).toBe(ca.clientId);
		expect(byId.get(jobs[1].id)).toBe(cb.clientId);
		expect(byId.get(jobs[2].id)).toBeNull();

		expect(seen.map((s) => s.key.startsWith('ak_issued_'))).toEqual([true, true, false]);
		expect(seen[0].key).not.toBe(seen[1].key);
		expect(seen[2].key).toBe(FALLBACK.apiKey);
		expect(seen[0].hook).toBe(webhookUrlFor('https://erms.example/', ca.clientId));
		expect(seen[0].hook).toBe(`https://erms.example/api/audiokit/webhook/${ca.clientId}`);
		expect(seen[2].hook).toBe('https://erms.example/api/audiokit/webhook');

		// Reconcile polls each job with the key of the client it was submitted under.
		await db.update(audiokitJobs).set({ submittedAt: new Date(Date.now() - 3_600_000) });
		await reconcileJobs(db, providerResolver(db, listedEnv, factory));
		expect(polled.sort()).toEqual(seen.map((s) => s.key).sort());
	});

	it('lets a job that never reached AudioKit fail terminally (EPSILON-135)', async () => {
		const orgId = await newOrg('never-submitted');
		const job = await newJob(orgId, 30);
		// The worker's max_attempts update for a job with no provider id.
		await db
			.update(audiokitJobs)
			.set({
				status: 'failed',
				error: { code: 'max_attempts', message: 'Job failed after maximum retry attempts' },
				finishedAt: new Date()
			})
			.where(eq(audiokitJobs.id, job.id));
		const [row] = await db.select().from(audiokitJobs).where(eq(audiokitJobs.id, job.id));
		expect(row.status).toBe('failed');

		// Any other non-queued state still needs the provider fields.
		const other = await newJob(orgId, 31);
		await expect(
			db.update(audiokitJobs).set({ status: 'submitted' }).where(eq(audiokitJobs.id, other.id))
		).rejects.toThrow();
	});

	it("leaves a revoked client's jobs unpolled instead of retrying a dead key", async () => {
		// Earlier tests leave submitted jobs behind; this one is about exactly one.
		await db.delete(audiokitJobs);
		const orgId = await newOrg('poll-revoked');
		const out = await issueLabelClient(db, fakeBilling(), ring, {
			orgId,
			actor: { id: ownerA, kind: 'user' }
		});
		const job = await newJob(orgId, 20);
		await db
			.update(audiokitJobs)
			.set({
				clientId: out.clientId,
				status: 'submitted',
				providerJobId: randomUUID(),
				submittedAt: new Date(Date.now() - 3_600_000)
			})
			.where(eq(audiokitJobs.id, job.id));
		await db
			.update(audiokitLabelClients)
			.set({ status: 'revoked', apiKeySealed: null, webhookSecretSealed: null })
			.where(eq(audiokitLabelClients.clientId, out.clientId));
		const status = vi.fn();
		const result = await reconcileJobs(
			db,
			providerResolver(db, env(), () => ({ status }) as never)
		);
		expect(status).not.toHaveBeenCalled();
		expect(result.checked).toBe(0);
	});

	describe('who can read the credentials table', () => {
		const probe = async (role: string, userId: string | null) => {
			const err = await db
				.transaction(async (tx) => {
					await tx.execute(
						sql`select set_config('role', ${role}, true), set_config('request.jwt.claim.sub', ${userId ?? ''}, true)`
					);
					return tx.select().from(audiokitLabelClients);
				})
				.then(
					() => null,
					(e) => e as { cause?: { code?: string } }
				);
			return err?.cause?.code;
		};

		it('is closed to members, the app role and the Data API roles', async () => {
			const orgId = await newOrg('rls');
			await issueLabelClient(db, fakeBilling(), ring, {
				orgId,
				actor: { id: ownerA, kind: 'user' }
			});
			// 42501: insufficient_privilege, for an owner of the label as much as anyone.
			expect(await probe('labelkit_app', ownerA)).toBe('42501');
			expect(await probe('labelkit_app', viewerA)).toBe('42501');
			expect(await probe('authenticated', ownerA)).toBe('42501');
			expect(await probe('anon', null)).toBe('42501');
			expect(
				await asUser(db, ownerA, (tx) =>
					tx
						.select({ n: sql`1` })
						.from(orgs)
						.limit(1)
				)
			).toBeDefined();
		});
	});
});
