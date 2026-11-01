import { readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { getRelease } from './catalog';
import { updateRecording } from './catalog-edit';
import {
	auditLog,
	credits,
	labels,
	memberships,
	orgs,
	parties,
	recordings,
	releases,
	releaseTracks
} from './db/schema';
import { asUser } from './db/scoped';
import { applyImport } from './import/apply';
import { parseSymphonicInventory } from './import/symphonic';
import { pickMembership } from './org';
import { createTestDb } from './test-db';

const SAMPLE = readFileSync(
	new URL('./import/__fixtures__/symphonic-sample.csv', import.meta.url),
	'utf8'
);

// Two labels. ownerA and viewerA belong to A, ownerB to B.
const ownerA = '00000000-0000-7000-8000-00000000000a';
const viewerA = '00000000-0000-7000-8000-0000000000a2';
const ownerB = '00000000-0000-7000-8000-00000000000b';

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
			{ orgId: orgB, userId: ownerB, role: 'owner' }
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

		it('cannot read or write orgs and memberships beyond reading its own', async () => {
			expect(
				await pgError(
					asUser(db, ownerA, (tx) =>
						tx.insert(memberships).values({ orgId: orgB, userId: ownerA, role: 'owner' })
					)
				)
			).toMatch(/permission denied/);
		});
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

	it('role and user settings end with the transaction', async () => {
		type Row = { u: string; sub: string | null };
		const who = sql`select current_user as u, nullif(current_setting('request.jwt.claim.sub', true), '') as sub`;
		// PGlite returns { rows }; the test database is always PGlite.
		const inside = await asUser(db, ownerA, async (tx) => (await tx.execute(who)) as unknown);
		expect((inside as { rows: Row[] }).rows[0]).toEqual({ u: 'erms_app', sub: ownerA });
		const after = (await db.execute(who)) as unknown as { rows: Row[] };
		expect(after.rows[0]).toEqual({ u: 'postgres', sub: null });
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
