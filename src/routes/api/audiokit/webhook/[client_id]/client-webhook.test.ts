import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
	advanceLabelClients,
	issueLabelClient,
	rotateLabelClient
} from '#lib/server/audiokit-clients.js';
import { applyWebhook } from '#lib/server/audiokit-webhook.js';
import { parseKeyRing } from '#lib/server/audiokit-credentials.js';
import { sign } from '#lib/server/audio/webhook.js';
import { audiokitJobs, masters, memberships, orgs, recordings } from '#lib/server/db/schema.js';
import { createTestDb } from '#lib/server/test-db.js';
import type { LabelClientsBilling } from '#lib/server/audio/billing.js';

/**
 * The per-label webhook route end to end, on the local Supabase stack: the secret is picked by the
 * client id in the path, a webhook signed with one client's secret at another client's URL fails,
 * a job of another org is never touched, and during a rotation each client verifies its own jobs.
 */

const held = vi.hoisted(() => ({
	db: undefined as unknown,
	keyEnv: `k1:${Buffer.alloc(32, 7).toString('base64')}`
}));
vi.mock('#lib/server/db/client.js', () => ({ db: () => held.db }));
vi.mock('$app/env/private', () => ({ AUDIOKIT_CREDENTIALS_KEY: held.keyEnv }));

const KEY_ENV = held.keyEnv;
const ring = parseKeyRing(KEY_ENV);
const owner = '00000000-0000-7000-8000-00000000000a';

let db: Awaited<ReturnType<typeof createTestDb>>['db'];
let POST: (event: never) => Promise<Response>;

function fakeBilling() {
	let n = 0;
	const issue = async (orgId: string) => {
		n++;
		return {
			httpStatus: 201 as const,
			label_client: {
				client_id: randomUUID(),
				erms_org_id: orgId,
				status: 'active',
				key_prefix: null,
				sync_state: 'synced' as const
			},
			credentials: { api_key: `ak_route_${n}`, webhook_secret: `whsec_route_${n}` }
		};
	};
	return {
		issue,
		rotate: issue,
		get: async () => ({ sync_state: 'synced' }),
		revoke: async () => ({ sync_state: 'revoked' })
	} as unknown as LabelClientsBilling;
}

async function seedOrg(slug: string) {
	const [{ id: orgId }] = await db
		.insert(orgs)
		.values({ name: `Invented ${slug}`, slug })
		.returning();
	await db.insert(memberships).values({ orgId, userId: owner, role: 'owner' });
	return orgId;
}

/** A submitted job under `clientId`, with the provider job id AudioKit would echo back. */
async function seedJob(orgId: string, clientId: string | null, n: number) {
	const [rec] = await db
		.insert(recordings)
		.values({ orgId, isrc: `XX000260${String(n).padStart(4, '0')}`, title: `Invented ${n}` })
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
		uploadedBy: owner
	});
	const providerJobId = randomUUID();
	const [job] = await db
		.insert(audiokitJobs)
		.values({
			orgId,
			recordingId: rec.id,
			masterId,
			operation: 'probe',
			requestedBy: owner,
			clientId,
			status: 'submitted',
			providerJobId,
			submittedAt: new Date()
		})
		.returning();
	return { job, providerJobId };
}

function eventFor(jobId: string, providerJobId: string) {
	const now = new Date().toISOString();
	return JSON.stringify({
		event_id: randomUUID(),
		type: 'job.canceled',
		created_at: now,
		data: {
			provider_job_id: providerJobId,
			job_id: jobId,
			operation: 'probe',
			status: 'canceled',
			created_at: now,
			started_at: now,
			finished_at: now
		}
	});
}

async function deliver(
	clientId: string,
	body: string,
	secret: string | null,
	ts = Math.floor(Date.now() / 1000)
) {
	const headers = secret ? { 'x-signature': sign(secret, body, ts) } : undefined;
	const call = POST({
		request: new Request(`https://erms.test/api/audiokit/webhook/${clientId}`, {
			method: 'POST',
			body,
			headers
		}),
		params: { client_id: clientId }
	} as never);
	// The route throws SvelteKit's HttpError for a refusal; a test wants the status either way.
	return call.catch((e: { status?: number }) => {
		if (typeof e?.status !== 'number') throw e;
		return { status: e.status } as Response;
	});
}

const status = async (jobId: string) =>
	(
		await db.select({ s: audiokitJobs.status }).from(audiokitJobs).where(eq(audiokitJobs.id, jobId))
	)[0].s;

async function secretOf(clientId: string) {
	const { credentialsForClient } = await import('#lib/server/audiokit-clients.js');
	const creds = await credentialsForClient(db, () => ring, clientId);
	return creds?.webhookSecret as string;
}

describe('per-label webhook route', () => {
	beforeAll(async () => {
		({ db } = await createTestDb());
		held.db = db;
		({ POST } = (await import('./+server.js')) as never);
	});

	it('applies a webhook signed with its own client secret', async () => {
		const orgId = await seedOrg('hook-ok');
		const { clientId } = await issueLabelClient(db, fakeBilling(), ring, {
			orgId,
			actor: { id: owner, kind: 'user' }
		});
		const { job, providerJobId } = await seedJob(orgId, clientId, 1);
		const res = await deliver(clientId, eventFor(job.id, providerJobId), await secretOf(clientId));
		expect(res.status).toBe(200);
		expect(await status(job.id)).toBe('canceled');
	});

	it('answers 404 for an unknown, malformed or pending client without verifying anything', async () => {
		const billing = fakeBilling();
		const orgId = await seedOrg('hook-unknown');
		const { clientId } = await issueLabelClient(db, billing, ring, {
			orgId,
			actor: { id: owner, kind: 'user' }
		});
		const { job, providerJobId } = await seedJob(orgId, clientId, 2);
		const body = eventFor(job.id, providerJobId);
		// Even a body signed with the right secret, at an id nobody owns.
		expect((await deliver(randomUUID(), body, await secretOf(clientId))).status).toBe(404);
		expect((await deliver('not-a-uuid', body, null)).status).toBe(404);
		expect(await status(job.id)).toBe('submitted');
	});

	it("rejects a webhook signed with another client's secret at this client's URL", async () => {
		const billing = fakeBilling();
		const a = await seedOrg('hook-x');
		const b = await seedOrg('hook-y');
		const ca = (
			await issueLabelClient(db, billing, ring, { orgId: a, actor: { id: owner, kind: 'user' } })
		).clientId;
		const cb = (
			await issueLabelClient(db, billing, ring, { orgId: b, actor: { id: owner, kind: 'user' } })
		).clientId;
		const { job, providerJobId } = await seedJob(a, ca, 3);
		const body = eventFor(job.id, providerJobId);
		// B's secret at A's URL, and A's secret at B's URL: both are bad signatures.
		expect((await deliver(ca, body, await secretOf(cb))).status).toBe(400);
		expect((await deliver(cb, body, await secretOf(ca))).status).toBe(400);
		expect(await status(job.id)).toBe('submitted');
	});

	it("never touches another org's job, even with a valid signature for its own client", async () => {
		const billing = fakeBilling();
		const a = await seedOrg('hook-p');
		const b = await seedOrg('hook-q');
		const ca = (
			await issueLabelClient(db, billing, ring, { orgId: a, actor: { id: owner, kind: 'user' } })
		).clientId;
		await issueLabelClient(db, billing, ring, { orgId: b, actor: { id: owner, kind: 'user' } });
		const { job, providerJobId } = await seedJob(
			b,
			(await db.select().from(audiokitJobs).where(eq(audiokitJobs.orgId, b))).at(0)?.clientId ??
				null,
			4
		);
		// A job of org B, named by a webhook that A's own client signed correctly.
		const res = await deliver(ca, eventFor(job.id, providerJobId), await secretOf(ca));
		expect(res.status).toBe(404);
		expect(await status(job.id)).toBe('submitted');
	});

	it('refuses a fallback job (no client) at a label URL', async () => {
		const orgId = await seedOrg('hook-fallback');
		const { clientId } = await issueLabelClient(db, fakeBilling(), ring, {
			orgId,
			actor: { id: owner, kind: 'user' }
		});
		const { job, providerJobId } = await seedJob(orgId, null, 5);
		const res = await deliver(clientId, eventFor(job.id, providerJobId), await secretOf(clientId));
		expect(res.status).toBe(404);
		expect(await status(job.id)).toBe('submitted');
	});

	it('during a rotation each client verifies its own jobs, and a retired one is refused', async () => {
		const billing = fakeBilling();
		const orgId = await seedOrg('hook-rotate');
		const admin = { orgId, actor: { id: owner, kind: 'user' as const } };
		const oldId = (await issueLabelClient(db, billing, ring, admin)).clientId;
		const oldSecret = await secretOf(oldId);
		const early = await seedJob(orgId, oldId, 6);
		const newId = (await rotateLabelClient(db, billing, ring, admin)).clientId;
		const late = await seedJob(orgId, newId, 7);
		expect(await secretOf(newId)).not.toBe(oldSecret);

		// The old job's webhook still lands at the old URL; the new job's at the new URL.
		expect(
			(await deliver(oldId, eventFor(early.job.id, early.providerJobId), oldSecret)).status
		).toBe(200);
		expect(
			(await deliver(newId, eventFor(late.job.id, late.providerJobId), await secretOf(newId)))
				.status
		).toBe(200);
		// Both jobs are finished, so the old client is idle.
		// Idle: the next sweep revokes the old client, whose URL then answers 404.
		await advanceLabelClients(db, billing);
		expect(
			(await deliver(oldId, eventFor(early.job.id, early.providerJobId), oldSecret)).status
		).toBe(404);
	});

	it('the original URL (deployment-wide secret) only applies to jobs with no label client', async () => {
		const orgId = await seedOrg('hook-legacy');
		const { clientId } = await issueLabelClient(db, fakeBilling(), ring, {
			orgId,
			actor: { id: owner, kind: 'user' }
		});
		const label = await seedJob(orgId, clientId, 10);
		const plain = await seedJob(orgId, null, 11);
		const apply = (j: { job: { id: string }; providerJobId: string }) => {
			const body = eventFor(j.job.id, j.providerJobId);
			return applyWebhook(db, {
				rawBody: body,
				signature: sign('whsec_deployment_wide', body, Math.floor(Date.now() / 1000)),
				secret: 'whsec_deployment_wide',
				scope: { kind: 'fallback' }
			});
		};
		expect(await apply(label)).toMatchObject({ status: 404 });
		expect(await status(label.job.id)).toBe('submitted');
		expect(await apply(plain)).toMatchObject({ status: 200 });
		expect(await status(plain.job.id)).toBe('canceled');
	});
});
