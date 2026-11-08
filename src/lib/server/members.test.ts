import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
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
