import { readFileSync } from 'node:fs';
import { eq, sql, and } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { getRelease } from './catalog';
import { updateRecording } from './catalog-edit';
import {
	audiokitJobs,
	auditLog,
	credits,
	labels,
	masters,
	memberships,
	orgs,
	parties,
	recordings,
	releases,
	releaseTracks
} from './db/schema';
import { uuidv7 } from './db/uuidv7';
import { asUser } from './db/scoped';
import { applyImport } from './import/apply';
import { parseSymphonicInventory } from './import/symphonic';
import { pickMembership, needsOnboarding } from './org';
import { createTestDb } from './test-db';

const SAMPLE = readFileSync(
	new URL('./import/__fixtures__/symphonic-sample.csv', import.meta.url),
	'utf8'
);

// Two labels. ownerA and viewerA belong to A, ownerB to B.
const ownerA = '00000000-0000-7000-8000-00000000000a';
const viewerA = '00000000-0000-7000-8000-0000000000a2';
const ownerB = '00000000-0000-7000-8000-00000000000b';
const viewerB = '00000000-0000-7000-8000-0000000000b2';

/** The Postgres error behind Drizzle's wrapper. */
async function pgError(p: Promise<unknown>) {
	const err = (await p.then(
		() => null,
		(e) => e
	)) as { cause?: { message?: string }; message?: string } | null;
	expect(err, 'expected the database to refuse').not.toBeNull();
	return err?.cause?.message ?? err?.message ?? '';
}

describe('tenant isolation', () => {
	let db: Awaited<ReturnType<typeof createTestDb>>['db'];
	let orgA: string;
	let orgB: string;
	let recB: typeof recordings.$inferSelect;
	let relA: typeof releases.$inferSelect;
	let relB: typeof releases.$inferSelect;

	beforeAll(async () => {
		({ db } = await createTestDb());
		[{ id: orgA }] = await db.insert(orgs).values({ name: 'Label A', slug: 'a' }).returning();
		[{ id: orgB }] = await db.insert(orgs).values({ name: 'Label B', slug: 'b' }).returning();
		await db.insert(memberships).values([
			{ orgId: orgA, userId: ownerA, role: 'owner' },
			{ orgId: orgA, userId: viewerA, role: 'viewer' },
			{ orgId: orgB, userId: ownerB, role: 'owner' },
			{ orgId: orgB, userId: viewerB, role: 'viewer' }
		]);
		// Both imports run the real write path under RLS, as their own owner.
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
		[recB] = await db.select().from(recordings).where(eq(recordings.orgId, orgB)).limit(1);
		[relA] = await db.select().from(releases).where(eq(releases.orgId, orgA)).limit(1);
		[relB] = await db.select().from(releases).where(eq(releases.orgId, orgB)).limit(1);
	});

	it('imports under RLS into each label separately', async () => {
		const [a] = await db
			.select({ n: sql<number>`count(*)::int` })
			.from(recordings)
			.where(eq(recordings.orgId, orgA));
		const [b] = await db
			.select({ n: sql<number>`count(*)::int` })
			.from(recordings)
			.where(eq(recordings.orgId, orgB));
		expect(a.n).toBeGreaterThan(0);
		expect(a.n).toBe(b.n);
	});

	describe('reads', () => {
		it('a member sees only their own label', async () => {
			for (const table of [labels, parties, recordings, releases, releaseTracks, credits]) {
				const rows = await asUser(db, ownerA, (tx) =>
					tx.select({ orgId: table.orgId }).from(table)
				);
				expect(rows.length).toBeGreaterThan(0);
				expect(new Set(rows.map((r) => r.orgId))).toEqual(new Set([orgA]));
			}
		});

		it('passing another label id to the app still returns nothing', async () => {
			expect(await asUser(db, ownerA, (tx) => getRelease(tx, orgB, relB.id))).toBeNull();
		});

		it('a user with no membership sees nothing', async () => {
			const stranger = '00000000-0000-7000-8000-0000000000ff';
			expect(await asUser(db, stranger, (tx) => tx.select().from(recordings))).toEqual([]);
			expect(await asUser(db, stranger, (tx) => tx.select().from(orgs))).toEqual([]);
		});

		it('only owners read the audit log', async () => {
			const asOwner = await asUser(db, ownerA, (tx) => tx.select().from(auditLog));
			expect(asOwner.length).toBeGreaterThan(0);
			expect(new Set(asOwner.map((r) => r.orgId))).toEqual(new Set([orgA]));
			expect(await asUser(db, viewerA, (tx) => tx.select().from(auditLog))).toEqual([]);
		});
	});

	describe('writes', () => {
		it('cannot insert into another label', async () => {
			const msg = await pgError(
				asUser(db, ownerA, (tx) => tx.insert(labels).values({ orgId: orgB, name: 'Injected' }))
			);
			expect(msg).toMatch(/row-level security/);
		});

		it('cannot update or delete another label’s rows', async () => {
			const updated = await asUser(db, ownerA, (tx) =>
				tx
					.update(recordings)
					.set({ title: 'Hijacked' })
					.where(eq(recordings.id, recB.id))
					.returning()
			);
			expect(updated).toEqual([]);
			const deleted = await asUser(db, ownerA, (tx) =>
				tx.delete(credits).where(eq(credits.orgId, orgB)).returning()
			);
			expect(deleted).toEqual([]);
			const [still] = await db.select().from(recordings).where(eq(recordings.id, recB.id));
			expect(still.title).toBe(recB.title);
		});

		it('cannot move a row into another label', async () => {
			const msg = await pgError(
				asUser(db, ownerA, (tx) =>
					tx.update(releases).set({ orgId: orgB }).where(eq(releases.id, relA.id))
				)
			);
			expect(msg).toMatch(/row-level security|foreign key/);
		});

		it('only catalog roles may update an AudioKit job', async () => {
			// Insert as the owner connection (bypasses RLS): a job needs a real
			// recording and master in its org.
			const masterId = uuidv7();
			await db.insert(masters).values({
				id: masterId,
				orgId: orgB,
				recordingId: recB.id,
				objectKey: `orgs/${orgB}/recordings/${recB.id}/masters/${masterId}.wav`,
				sizeBytes: 1000,
				fileName: 'master.wav',
				uploadedBy: ownerB
			});
			const [job] = await db
				.insert(audiokitJobs)
				.values({
					orgId: orgB,
					recordingId: recB.id,
					masterId,
					operation: 'probe',
					requestedBy: ownerB
				})
				.returning();

			// An owner in the job's org may update it; a viewer in the same org and
			// an owner of another org may not.
			const asOwner = await asUser(db, ownerB, (tx) =>
				tx
					.update(audiokitJobs)
					.set({
						status: 'canceled',
						providerJobId: uuidv7(),
						submittedAt: new Date(),
						finishedAt: new Date()
					})
					.where(eq(audiokitJobs.id, job.id))
					.returning()
			);
			expect(asOwner).toHaveLength(1);

			const asViewer = await asUser(db, viewerB, (tx) =>
				tx
					.update(audiokitJobs)
					.set({ status: 'succeeded' })
					.where(eq(audiokitJobs.id, job.id))
					.returning()
			);
			expect(asViewer).toEqual([]);

			const asOtherOrg = await asUser(db, ownerA, (tx) =>
				tx
					.update(audiokitJobs)
					.set({ status: 'failed' })
					.where(eq(audiokitJobs.id, job.id))
					.returning()
			);
			expect(asOtherOrg).toEqual([]);
		});

		it('a viewer cannot write, even through the app', async () => {
			const [recA] = await db.select().from(recordings).where(eq(recordings.orgId, orgA)).limit(1);
			const before = recA.title;
			const msg = await pgError(
				asUser(db, viewerA, (tx) =>
					updateRecording(
						tx,
						{ orgId: orgA, actor: { id: viewerA, kind: 'user' } },
						recA.id,
						{
							title: 'Viewer edit',
							versionTitle: recA.versionTitle ?? '',
							isrc: recA.isrc,
							duration: '',
							genre: recA.genre ?? '',
							subgenre: recA.subgenre ?? ''
						},
						recA.updatedAt.toISOString()
					)
				)
			);
			// RLS hides the row from the viewer's UPDATE, so the edit matches nothing.
			expect(msg).toMatch(/not found|row-level security/);
			const [after] = await db.select().from(recordings).where(eq(recordings.id, recA.id));
			expect(after.title).toBe(before);
		});

		it('cannot write audit entries for another label or another user', async () => {
			const entry = { entity: 'x', entityId: 'x', action: 'x', actorKind: 'user' as const };
			expect(
				await pgError(
					asUser(db, ownerA, (tx) =>
						tx.insert(auditLog).values({ ...entry, orgId: orgB, actorId: ownerA })
					)
				)
			).toMatch(/row-level security/);
			expect(
				await pgError(
					asUser(db, ownerA, (tx) =>
						tx.insert(auditLog).values({ ...entry, orgId: orgA, actorId: ownerB })
					)
				)
			).toMatch(/row-level security/);
		});

		it('cannot write orgs, nor place itself in another org', async () => {
			// Since EPSILON-87 owners write their own org's memberships; another org's stay refused,
			// by row-level security rather than by privilege (drizzle/0017_members_manage.sql).
			expect(
				await pgError(
					asUser(db, ownerA, (tx) =>
						tx.insert(memberships).values({ orgId: orgB, userId: ownerA, role: 'owner' })
					)
				)
			).toMatch(/row-level security/);
			expect(
				await pgError(
					asUser(db, ownerA, (tx) => tx.insert(orgs).values({ name: 'Sneaky', slug: 'sneaky' }))
				)
			).toMatch(/permission denied/);
		});
	});

	it('a member can complete only their own onboarding', async () => {
		await asUser(db, viewerA, (tx) =>
			tx.execute(sql`select app.complete_onboarding(${orgA}::uuid)`)
		);
		const stamp = async (orgId: string, userId: string) => {
			const [row] = await db
				.select({ onboardedAt: memberships.onboardedAt })
				.from(memberships)
				.where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)));
			return row?.onboardedAt ?? null;
		};
		expect(await stamp(orgA, viewerA)).not.toBeNull();
		expect(await stamp(orgA, ownerA)).toBeNull();

		// Calling it for an org you are not in changes nothing.
		await asUser(db, ownerA, (tx) =>
			tx.execute(sql`select app.complete_onboarding(${orgB}::uuid)`)
		);
		expect(await stamp(orgB, ownerB)).toBeNull();
	});

	describe('links between rows', () => {
		it('the database refuses a track that points into another label', async () => {
			const msg = await pgError(
				db.insert(releaseTracks).values({
					orgId: orgA,
					releaseId: relA.id,
					recordingId: recB.id,
					disc: 9,
					position: 1
				})
			);
			expect(msg).toMatch(/foreign key/);
		});

		it('the database refuses a credit for another label’s artist', async () => {
			const [partyB] = await db.select().from(parties).where(eq(parties.orgId, orgB)).limit(1);
			const msg = await pgError(
				db.insert(credits).values({
					orgId: orgA,
					releaseId: relA.id,
					partyId: partyB.id,
					role: 'featured',
					source: 'test'
				})
			);
			expect(msg).toMatch(/foreign key/);
		});
	});

	it('the database rejects malformed values even when the app is bypassed', async () => {
		const [recA] = await db.select().from(recordings).where(eq(recordings.orgId, orgA)).limit(1);
		const bad = [
			db.update(recordings).set({ isrc: 'not-an-isrc' }).where(eq(recordings.id, recA.id)),
			db.update(recordings).set({ durationMs: 0 }).where(eq(recordings.id, recA.id)),
			db.update(releases).set({ upc: '123' }).where(eq(releases.id, relA.id)),
			db.update(releaseTracks).set({ position: 0 }).where(eq(releaseTracks.releaseId, relA.id))
		];
		for (const q of bad) expect(await pgError(q)).toMatch(/check constraint/);
	});

	it('role and user settings end with the transaction', async () => {
		type Row = { u: string; sub: string | null };
		const who = sql`select current_user as u, nullif(current_setting('request.jwt.claim.sub', true), '') as sub`;
		// postgres-js returns the rows as an array, as in production.
		const inside = await asUser(db, ownerA, async (tx) => (await tx.execute(who)) as unknown);
		expect((inside as Row[])[0]).toEqual({ u: 'erms_app', sub: ownerA });
		const after = (await db.execute(who)) as unknown as Row[];
		expect(after[0]).toEqual({ u: 'postgres', sub: null });
	});
});

describe('pickMembership', () => {
	const rows = [
		{ orgId: 'a', orgName: 'A', role: 'owner' as const },
		{ orgId: 'b', orgName: 'B', role: 'viewer' as const }
	];
	it('uses the cookie when the user belongs to that label', () => {
		expect(pickMembership(rows, 'b')?.orgId).toBe('b');
	});
	it('falls back to the oldest membership otherwise', () => {
		expect(pickMembership(rows, 'gone')?.orgId).toBe('a');
		expect(pickMembership(rows, undefined)?.orgId).toBe('a');
	});
	it('is null without memberships', () => {
		expect(pickMembership([], 'a')).toBeNull();
	});
});

describe('needsOnboarding', () => {
	const exempt = ['/login', '/onboarding', '/logout'];
	const member = { orgId: 'a', orgName: 'A', role: 'viewer' as const };

	it('is true for a member who has not onboarded', () => {
		expect(needsOnboarding({ ...member, onboardedAt: null }, '/', exempt)).toBe(true);
	});

	it('is false once onboarded, without a membership, or on an exempt path', () => {
		expect(needsOnboarding({ ...member, onboardedAt: new Date() }, '/', exempt)).toBe(false);
		expect(needsOnboarding(null, '/', exempt)).toBe(false);
		expect(needsOnboarding({ ...member, onboardedAt: null }, '/onboarding', exempt)).toBe(false);
	});

	it('matches exempt paths exactly, not by prefix', () => {
		for (const path of ['/onboardingx', '/onboarding/other', '/logout-later', '/loginx']) {
			expect(needsOnboarding({ ...member, onboardedAt: null }, path, exempt), path).toBe(true);
		}
	});
});
