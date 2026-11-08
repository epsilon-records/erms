import { and, eq, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Database } from './audit';
import { EditError } from './catalog-edit';
import { auditLog, memberships, orgs } from './db/schema';
import { asUser } from './db/scoped';
import { addMember, canManageMembers, changeRole, listMembers, removeMember } from './members';
import { createTestDb } from './test-db';

// Invented labels and people. ownerA owns A; viewerA is a viewer there. ownerB owns B.
const ownerA = '00000000-0000-7000-8000-0000000000a1';
const viewerA = '00000000-0000-7000-8000-0000000000a2';
const ownerB = '00000000-0000-7000-8000-0000000000b1';
const invitee = '00000000-0000-7000-8000-0000000000c1';

type Db = Awaited<ReturnType<typeof createTestDb>>['db'];

const actor = (id: string) => ({ id, kind: 'user' as const });

async function refusal(p: Promise<unknown>) {
	const err = await p.then(
		() => null,
		(e) => e
	);
	expect(err, 'expected a refusal').toBeInstanceOf(EditError);
	return (err as EditError).fields;
}

describe('member management (EPSILON-87)', () => {
	let db: Db;
	let orgA: string;
	let orgB: string;

	const membersOf = (orgId: string) =>
		db.select().from(memberships).where(eq(memberships.orgId, orgId));
	const auditOf = (orgId: string) =>
		db
			.select()
			.from(auditLog)
			.where(and(eq(auditLog.orgId, orgId), eq(auditLog.entity, 'membership')));

	beforeEach(async () => {
		({ db } = await createTestDb());
		[{ id: orgA }] = await db.insert(orgs).values({ name: 'Label A', slug: 'a' }).returning();
		[{ id: orgB }] = await db.insert(orgs).values({ name: 'Label B', slug: 'b' }).returning();
		await db.insert(memberships).values([
			{ orgId: orgA, userId: ownerA, role: 'owner' },
			{ orgId: orgA, userId: viewerA, role: 'viewer' },
			{ orgId: orgB, userId: ownerB, role: 'owner' }
		]);
	});

	// Two transactions plus a third observer connection. Hold the first after its write,
	// start the second, and observe an actual database lock wait before allowing commit.
	// This catches stale reads even when the eventual UPDATE itself also blocks.
	async function interleave(
		first: (tx: Database) => Promise<unknown>,
		second: (tx: Database) => Promise<unknown>
	) {
		const written = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const started = Promise.withResolvers<number>();
		let firstPid = 0;
		const a = db.transaction(async (tx) => {
			const [row] = await tx.execute(sql`select pg_backend_pid() as pid`);
			firstPid = Number(row.pid);
			await tx.execute(sql`set local statement_timeout = '5s'`);
			const result = await first(tx);
			written.resolve();
			await release.promise;
			return result;
		});
		// Propagate setup failures rather than leaving the barrier unresolved.
		void a.catch(written.reject);
		await written.promise;
		const b = db.transaction(async (tx) => {
			const [row] = await tx.execute(sql`select pg_backend_pid() as pid`);
			await tx.execute(sql`set local statement_timeout = '5s'`);
			started.resolve(Number(row.pid));
			return second(tx);
		});
		// Attach immediately: expected last-owner failures must not become unhandled.
		void b.catch(started.reject);
		const results = Promise.allSettled([a, b]);
		try {
			const secondPid = await started.promise;
			expect(secondPid).not.toBe(firstPid);
			await expect
				.poll(
					async () => {
						const [row] = await db.execute(
							sql`select ${firstPid}::int = any(pg_blocking_pids(${secondPid}::int)) as blocked`
						);
						return row.blocked;
					},
					{ timeout: 3000, interval: 10 }
				)
				.toBe(true);
		} finally {
			release.resolve();
			await results;
		}
		return results;
	}

	describe('coordinated concurrent changes', () => {
		it.each(['rights_admin', 'catalog_manager', 'remove'] as const)(
			'locks the audit role before a concurrent %s',
			async (next) => {
				const ctx = { orgId: orgA, actor: actor(ownerA) };
				const results = await interleave(
					(tx) =>
						asUser(tx, ownerA, (scoped) => changeRole(scoped, ctx, viewerA, 'catalog_manager')),
					(tx) =>
						asUser(tx, ownerA, (scoped) =>
							next === 'remove'
								? removeMember(scoped, ctx, viewerA)
								: changeRole(scoped, ctx, viewerA, next)
						)
				);
				expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
				const entries = await auditOf(orgA);
				expect(entries).toHaveLength(next === 'catalog_manager' ? 1 : 2);
				expect(entries).toEqual(
					expect.arrayContaining([
						expect.objectContaining({
							action: 'member_role',
							before: { role: 'viewer' },
							after: { role: 'catalog_manager' }
						})
					])
				);
				if (next !== 'catalog_manager')
					expect(entries).toEqual(
						expect.arrayContaining([
							expect.objectContaining({
								action: next === 'remove' ? 'member_remove' : 'member_role',
								before: { role: 'catalog_manager' }
							})
						])
					);
				const target = (await membersOf(orgA)).find((m) => m.userId === viewerA);
				if (next === 'remove') expect(target).toBeUndefined();
				else expect(target?.role).toBe(next);
			}
		);

		it('serializes two owners stepping down through the audited RLS path', async () => {
			await db.update(memberships).set({ role: 'owner' }).where(eq(memberships.userId, viewerA));
			const results = await interleave(
				(tx) =>
					asUser(tx, ownerA, (scoped) =>
						changeRole(scoped, { orgId: orgA, actor: actor(ownerA) }, ownerA, 'viewer')
					),
				(tx) =>
					asUser(tx, viewerA, (scoped) =>
						changeRole(scoped, { orgId: orgA, actor: actor(viewerA) }, viewerA, 'viewer')
					)
			);
			expect(results[0].status).toBe('fulfilled');
			expect(results[1]).toMatchObject({
				status: 'rejected',
				reason: { fields: { form: expect.stringMatching(/at least one owner/i) } }
			});
			expect(
				(await membersOf(orgA)).filter((m) => m.role === 'owner').map((m) => m.userId)
			).toEqual([viewerA]);
			expect(await auditOf(orgA)).toEqual([
				expect.objectContaining({
					actorId: ownerA,
					before: { role: 'owner' },
					after: { role: 'viewer' }
				})
			]);
		});

		it.each(['demote', 'remove'] as const)(
			'serializes last-owner demotion against %s on the owner connection',
			async (next) => {
				await db.update(memberships).set({ role: 'owner' }).where(eq(memberships.userId, viewerA));
				const results = await interleave(
					(tx) =>
						tx
							.update(memberships)
							.set({ role: 'viewer' })
							.where(and(eq(memberships.orgId, orgA), eq(memberships.userId, ownerA))),
					(tx) =>
						next === 'remove'
							? tx
									.delete(memberships)
									.where(and(eq(memberships.orgId, orgA), eq(memberships.userId, viewerA)))
							: tx
									.update(memberships)
									.set({ role: 'viewer' })
									.where(and(eq(memberships.orgId, orgA), eq(memberships.userId, viewerA)))
				);
				expect(results[0].status).toBe('fulfilled');
				expect(results[1]).toMatchObject({
					status: 'rejected',
					reason: { cause: { code: '23514', constraint_name: 'memberships_keep_one_owner' } }
				});
				expect(
					(await membersOf(orgA)).filter((m) => m.role === 'owner').map((m) => m.userId)
				).toEqual([viewerA]);
			}
		);
	});

	describe('invite', () => {
		it('adds the invitee with the chosen role and audits it, without their address', async () => {
			const out = await asUser(db, ownerA, (tx) =>
				addMember(
					tx,
					{ orgId: orgA, actor: actor(ownerA) },
					{
						userId: invitee,
						role: 'catalog_manager',
						emailed: true
					}
				)
			);
			expect(out).toBe('added');
			const row = (await membersOf(orgA)).find((m) => m.userId === invitee);
			expect(row?.role).toBe('catalog_manager');
			expect(row?.onboardedAt).toBeNull(); // lands in onboarding

			const [entry] = await auditOf(orgA);
			expect(entry).toMatchObject({
				actorId: ownerA,
				actorKind: 'user',
				entityId: invitee,
				action: 'member_invite',
				after: { role: 'catalog_manager', emailed: true }
			});
			expect(JSON.stringify(entry)).not.toContain('@');
		});

		it('reports an existing member and changes nothing', async () => {
			const out = await asUser(db, ownerA, (tx) =>
				addMember(
					tx,
					{ orgId: orgA, actor: actor(ownerA) },
					{
						userId: viewerA,
						role: 'owner',
						emailed: false
					}
				)
			);
			expect(out).toBe('already');
			expect((await membersOf(orgA)).find((m) => m.userId === viewerA)?.role).toBe('viewer');
			expect(await auditOf(orgA)).toEqual([]);
		});

		it('refuses a cross-org invite, writing nothing in either org', async () => {
			// ownerA names org B, as a forged form or a stale session would.
			const fields = await refusal(
				asUser(db, ownerA, (tx) =>
					addMember(
						tx,
						{ orgId: orgB, actor: actor(ownerA) },
						{
							userId: invitee,
							role: 'viewer',
							emailed: true
						}
					)
				)
			);
			expect(fields.form).toMatch(/only an owner/i);
			expect((await membersOf(orgB)).map((m) => m.userId)).toEqual([ownerB]);
			expect(await auditOf(orgB)).toEqual([]);
			expect(await auditOf(orgA)).toEqual([]);
		});

		it('refuses an invite from a non-owner', async () => {
			await refusal(
				asUser(db, viewerA, (tx) =>
					addMember(
						tx,
						{ orgId: orgA, actor: actor(viewerA) },
						{
							userId: invitee,
							role: 'viewer',
							emailed: true
						}
					)
				)
			);
			expect((await membersOf(orgA)).some((m) => m.userId === invitee)).toBe(false);
		});

		it('never hands out the agent role', async () => {
			await expect(
				asUser(db, ownerA, (tx) =>
					addMember(
						tx,
						{ orgId: orgA, actor: actor(ownerA) },
						{
							userId: invitee,
							role: 'agent',
							emailed: true
						}
					)
				)
			).rejects.toThrow();
			expect((await membersOf(orgA)).some((m) => m.userId === invitee)).toBe(false);
		});

		it('the pre-check asks the database, per org', async () => {
			expect(await asUser(db, ownerA, (tx) => canManageMembers(tx, orgA))).toBe(true);
			expect(await asUser(db, ownerA, (tx) => canManageMembers(tx, orgB))).toBe(false);
			expect(await asUser(db, viewerA, (tx) => canManageMembers(tx, orgA))).toBe(false);
		});
	});

	describe('role change', () => {
		it('changes a role and audits before and after', async () => {
			await asUser(db, ownerA, (tx) =>
				changeRole(tx, { orgId: orgA, actor: actor(ownerA) }, viewerA, 'rights_admin')
			);
			expect((await membersOf(orgA)).find((m) => m.userId === viewerA)?.role).toBe('rights_admin');
			const [entry] = await auditOf(orgA);
			expect(entry).toMatchObject({
				action: 'member_role',
				entityId: viewerA,
				before: { role: 'viewer' },
				after: { role: 'rights_admin' }
			});
		});

		it('saving the same role writes nothing', async () => {
			await asUser(db, ownerA, (tx) =>
				changeRole(tx, { orgId: orgA, actor: actor(ownerA) }, viewerA, 'viewer')
			);
			expect(await auditOf(orgA)).toEqual([]);
		});

		it('a non-owner cannot change roles, their own included', async () => {
			await refusal(
				asUser(db, viewerA, (tx) =>
					changeRole(tx, { orgId: orgA, actor: actor(viewerA) }, viewerA, 'owner')
				)
			);
			expect((await membersOf(orgA)).find((m) => m.userId === viewerA)?.role).toBe('viewer');
		});

		it('an owner of another label cannot change roles here', async () => {
			await refusal(
				asUser(db, ownerB, (tx) =>
					changeRole(tx, { orgId: orgA, actor: actor(ownerB) }, viewerA, 'owner')
				)
			);
			expect((await membersOf(orgA)).find((m) => m.userId === viewerA)?.role).toBe('viewer');
		});

		it('refuses a role that is not offered', async () => {
			const fields = await refusal(
				asUser(db, ownerA, (tx) =>
					changeRole(tx, { orgId: orgA, actor: actor(ownerA) }, viewerA, 'agent')
				)
			);
			expect(fields.role).toBeDefined();
		});
	});

	describe('last owner', () => {
		it('the only owner cannot step down, and nothing is audited', async () => {
			const fields = await refusal(
				asUser(db, ownerA, (tx) =>
					changeRole(tx, { orgId: orgA, actor: actor(ownerA) }, ownerA, 'viewer')
				)
			);
			expect(fields.form).toMatch(/at least one owner/i);
			expect((await membersOf(orgA)).find((m) => m.userId === ownerA)?.role).toBe('owner');
			expect(await auditOf(orgA)).toEqual([]);
		});

		it('the only owner cannot be removed', async () => {
			const fields = await refusal(
				asUser(db, ownerA, (tx) => removeMember(tx, { orgId: orgA, actor: actor(ownerA) }, ownerA))
			);
			expect(fields.form).toMatch(/at least one owner/i);
			expect(await auditOf(orgA)).toEqual([]);
		});

		it('counts owners per org: another label having owners does not help', async () => {
			// ownerB is an owner too, but of B. A still has one owner.
			await db.insert(memberships).values({ orgId: orgB, userId: ownerA, role: 'owner' });
			await refusal(
				asUser(db, ownerA, (tx) =>
					changeRole(tx, { orgId: orgA, actor: actor(ownerA) }, ownerA, 'viewer')
				)
			);
		});

		it('with a second owner, the first may step down or leave', async () => {
			await asUser(db, ownerA, (tx) =>
				changeRole(tx, { orgId: orgA, actor: actor(ownerA) }, viewerA, 'owner')
			);
			await asUser(db, ownerA, (tx) =>
				removeMember(tx, { orgId: orgA, actor: actor(ownerA) }, ownerA)
			);
			expect((await membersOf(orgA)).map((m) => [m.userId, m.role])).toEqual([[viewerA, 'owner']]);
			// The departing owner's removal is still on record, under their own id.
			const actions = (await auditOf(orgA)).map((a) => [a.actorId, a.action, a.entityId]);
			expect(actions).toContainEqual([ownerA, 'member_remove', ownerA]);
		});
	});

	describe('removal', () => {
		it('removes a member and audits the role they had', async () => {
			await asUser(db, ownerA, (tx) =>
				removeMember(tx, { orgId: orgA, actor: actor(ownerA) }, viewerA)
			);
			expect((await membersOf(orgA)).map((m) => m.userId)).toEqual([ownerA]);
			const [entry] = await auditOf(orgA);
			expect(entry).toMatchObject({
				action: 'member_remove',
				entityId: viewerA,
				before: { role: 'viewer' }
			});
		});

		it('an owner of another label cannot remove anyone here', async () => {
			await refusal(
				asUser(db, ownerB, (tx) => removeMember(tx, { orgId: orgA, actor: actor(ownerB) }, viewerA))
			);
			expect((await membersOf(orgA)).length).toBe(2);
		});

		it('a non-owner cannot remove anyone', async () => {
			await refusal(
				asUser(db, viewerA, (tx) =>
					removeMember(tx, { orgId: orgA, actor: actor(viewerA) }, ownerA)
				)
			);
		});
	});

	it('lists only the active label', async () => {
		const rows = await asUser(db, ownerA, (tx) => listMembers(tx, orgA));
		expect(rows.map((r) => r.userId).sort()).toEqual([ownerA, viewerA].sort());
		expect(await asUser(db, ownerA, (tx) => listMembers(tx, orgB))).toEqual([]);
	});
});
