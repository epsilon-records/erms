import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { isWavHeader } from '../masters';
import { recordSystemAudit, type Database, type Tx } from './audit';
import { masters } from './db/schema';
import type { MasterStorage } from './storage/r2';

/**
 * The background check of an uploaded master (EPSILON-120). Completing an upload records the
 * SHA-256 the browser reports and sets the master to `verifying`. This module, called from
 * POST /api/internal/verify-masters on the owner connection, leases masters to check and records
 * what the background read found: `ready` with the server's own hash, or rejected.
 *
 * Nothing trusts a `verifying` master. Jobs, exports and downloads all require `ready`. A check
 * that crashes or never reports keeps the master `verifying`, and it is leased again once its
 * lease runs out.
 */

const ACTOR = 'system:master-verify';

/** Longer than a background function can run (15 min), so a live read is never leased twice. */
export const LEASE_MS = 20 * 60_000;
/** How long the GET URL handed to the background read stays valid. */
export const READ_URL_TTL_SECONDS = 15 * 60;
/** Masters leased per run. */
export const LEASE_BATCH = 5;
/** Failed reads before a master is rejected, so a file that cannot be read is not retried forever. */
export const MAX_ATTEMPTS = 5;
/** After a failed read, wait BACKOFF_SECONDS * 2^attempts: 2, 4, 8 and 16 minutes. */
export const BACKOFF_SECONDS = 60;
export const UNREADABLE = 'LabelKit could not read the stored file; upload it again.';

export type VerifyJob = { id: string; token: string; url: string };

/** Reject a master that is being checked: delete its object, mark it rejected, audit why. */
async function rejectVerifying(
	tx: Tx,
	storage: MasterStorage,
	row: { id: string; orgId: string; objectKey: string },
	reason: string,
	detail: Record<string, unknown> = {}
) {
	await storage.remove(row.objectKey);
	await tx
		.update(masters)
		.set({ status: 'rejected', verifyToken: null, verifyStartedAt: null })
		.where(eq(masters.id, row.id));
	await recordSystemAudit(tx, {
		orgId: row.orgId,
		actorId: ACTOR,
		entity: 'master',
		entityId: row.id,
		action: 'upload_reject',
		before: { status: 'verifying' },
		after: { status: 'rejected', reason, ...detail }
	});
	return 'rejected' as const;
}

/**
 * Lease up to `limit` masters waiting to be checked: those never leased, and those whose lease ran
 * out without a result (after MAX_ATTEMPTS of those, the master is rejected instead). Each lease gets a fresh token, so a late result from an older lease is
 * ignored. Returns a presigned GET for each.
 */
export async function leaseVerifications(
	db: Database,
	storage: MasterStorage,
	{
		limit = LEASE_BATCH,
		leaseMs = LEASE_MS,
		backoffSeconds = BACKOFF_SECONDS
	}: { limit?: number; leaseMs?: number; backoffSeconds?: number } = {}
): Promise<VerifyJob[]> {
	// A master whose last allowed read never reported back (the function crashed or timed out
	// every time) is rejected here rather than leased again. Each in its own transaction: a file
	// that cannot be deleted right now leaves that master for a later run and blocks nothing else.
	const exhausted = (await db.execute(sql`
		select id from masters
		where status = 'verifying' and verify_attempts >= ${MAX_ATTEMPTS}
			and verify_started_at < now() - make_interval(secs => ${leaseMs / 1000})
		order by created_at
		limit ${limit}`)) as unknown as { id: string }[];
	for (const { id } of exhausted) {
		try {
			await db.transaction(async (tx) => {
				const [row] = (await tx.execute(sql`
					select id, org_id, object_key, verify_attempts from masters
					where id = ${id}::uuid and status = 'verifying' and verify_attempts >= ${MAX_ATTEMPTS}
						and verify_started_at < now() - make_interval(secs => ${leaseMs / 1000})
					for update skip locked`)) as unknown as {
					id: string;
					org_id: string;
					object_key: string;
					verify_attempts: number;
				}[];
				if (!row) return;
				await rejectVerifying(
					tx,
					storage,
					{ id: row.id, orgId: row.org_id, objectKey: row.object_key },
					UNREADABLE,
					{ attempts: row.verify_attempts }
				);
			});
		} catch (e) {
			console.error(
				JSON.stringify({
					level: 'error',
					msg: 'could not reject unreadable master',
					id,
					e: String(e)
				})
			);
		}
	}

	const leased = (await db.execute(sql`
		update masters set
			verify_token = gen_random_uuid(),
			verify_started_at = now(),
			verify_attempts = verify_attempts + 1
		where id in (
			select id from masters
			where status = 'verifying'
				and verify_attempts < ${MAX_ATTEMPTS}
				and (verify_started_at is null
					-- A lease that ran out without a result.
					or (verify_token is not null
						and verify_started_at < now() - make_interval(secs => ${leaseMs / 1000}))
					-- A read that failed: wait 2^attempts minutes, so a short outage cannot use up
					-- every attempt and reject a healthy master.
					or (verify_token is null
						and verify_started_at < now()
							- make_interval(secs => ${backoffSeconds} * power(2, verify_attempts))))
			order by created_at
			limit ${limit}
			for update skip locked
		)
		returning id, object_key, verify_token, verify_attempts`)) as unknown as {
		id: string;
		object_key: string;
		verify_token: string;
		verify_attempts: number;
	}[];
	return Promise.all(
		leased.map(async (row) => ({
			id: row.id,
			token: row.verify_token,
			url: await storage.presignGet(row.object_key, READ_URL_TTL_SECONDS)
		}))
	);
}

const HEX64 = /^[0-9a-f]{64}$/;
export const VerifyResult = z.union([
	z.object({
		id: z.uuid(),
		token: z.uuid(),
		sha256: z.string().regex(HEX64),
		size: z.number().int().nonnegative(),
		header: z.string().regex(/^(?:[0-9a-f]{2}){0,12}$/)
	}),
	z.object({
		id: z.uuid(),
		token: z.uuid(),
		error: z.string().max(200),
		/** The storage answer, when there was one. 404: the object is gone, which is final. */
		status: z.number().int().optional()
	})
]);
export type VerifyResult = z.infer<typeof VerifyResult>;

/** What a completed read says about a master: its verdict, never a guess. */
export function judge(
	expected: { sizeBytes: number; claimedSha256: string },
	read: { sha256: string; size: number; header: Uint8Array }
): { ok: true; sha256: string } | { ok: false; reason: string } {
	if (read.size !== expected.sizeBytes) {
		return {
			ok: false,
			reason: `Stored file is ${read.size} bytes, expected ${expected.sizeBytes}.`
		};
	}
	if (!isWavHeader(read.header))
		return { ok: false, reason: 'The uploaded file is not a WAV file.' };
	if (read.sha256 !== expected.claimedSha256) {
		return {
			ok: false,
			reason: 'The stored file does not match the checksum the upload reported. Upload it again.'
		};
	}
	return { ok: true, sha256: read.sha256 };
}

export type VerifyOutcome = 'ready' | 'rejected' | 'retry' | 'stale';

/**
 * Record one background read. A result for a lease that is no longer current (a newer lease, or
 * the master was deleted or already decided) changes nothing. A read that failed ends the lease,
 * and the master is leased again after a backoff that doubles each time, up to MAX_ATTEMPTS reads.
 * After that, or at once if the object is gone (the reader got 404 and so does this side's HEAD),
 * the master is rejected.
 */
export async function recordVerification(
	db: Database,
	storage: MasterStorage,
	result: VerifyResult
): Promise<VerifyOutcome> {
	return db.transaction(async (tx) => {
		const [row] = await tx
			.select()
			.from(masters)
			.where(
				and(
					eq(masters.id, result.id),
					eq(masters.status, 'verifying'),
					eq(masters.verifyToken, result.token)
				)
			)
			.for('update');
		if (!row || !row.claimedSha256) return 'stale';

		const reject = (reason: string, detail?: Record<string, unknown>) =>
			rejectVerifying(tx, storage, row, reason, detail);

		if ('error' in result) {
			// A missing object will not come back, and a file that has failed MAX_ATTEMPTS reads is
			// not going to be checked: reject it, so the upload ends and the person is told why.
			// A 404 is final only if this side's own HEAD agrees: R2 also answers 404 for a missing
			// bucket, and a misconfigured reader must not reject every master.
			const gone = result.status === 404 && !(await storage.head(row.objectKey));
			if (gone || row.verifyAttempts >= MAX_ATTEMPTS) {
				return reject(UNREADABLE, { attempts: row.verifyAttempts });
			}
			// End the lease but keep the time of the failure: the next lease waits for the backoff.
			await tx
				.update(masters)
				.set({ verifyToken: null, verifyStartedAt: new Date() })
				.where(eq(masters.id, row.id));
			console.warn(
				JSON.stringify({
					level: 'warn',
					msg: 'master check failed; will retry',
					id: row.id,
					attempts: row.verifyAttempts,
					error: result.error
				})
			);
			return 'retry';
		}

		const verdict = judge(
			{ sizeBytes: row.sizeBytes, claimedSha256: row.claimedSha256 },
			{ sha256: result.sha256, size: result.size, header: Buffer.from(result.header, 'hex') }
		);
		if (!verdict.ok) return reject(verdict.reason);

		const completedAt = new Date();
		await tx
			.update(masters)
			.set({
				status: 'ready',
				sha256: verdict.sha256,
				completedAt,
				verifyToken: null,
				verifyStartedAt: null
			})
			.where(eq(masters.id, row.id));
		await recordSystemAudit(tx, {
			orgId: row.orgId,
			actorId: ACTOR,
			entity: 'master',
			entityId: row.id,
			action: 'upload_verified',
			before: { status: 'verifying' },
			after: { status: 'ready', sha256: verdict.sha256, sizeBytes: row.sizeBytes, completedAt }
		});
		return 'ready';
	});
}
