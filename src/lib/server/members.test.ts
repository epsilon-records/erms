import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { sql, eq } from 'drizzle-orm';
import { createTestDb } from './test-db';
import { asUser } from './db/scoped';
import { memberships, orgs, auditLog } from './db/schema';
import { changeMember, inviteMember, resendInvitation } from './members';

async function setup() {
	const { db, client } = await createTestDb();
	const org = randomUUID(),
		other = randomUUID(),
		owner = randomUUID(),
		outsider = randomUUID(),
		viewer = randomUUID();
	await db.insert(orgs).values([
		{ id: org, name: 'Alpha Label', slug: 'alpha' },
		{ id: other, name: 'Beta Label', slug: 'beta' }
	]);
	await db.insert(memberships).values([
		{ orgId: org, userId: owner, role: 'owner' },
		{ orgId: other, userId: outsider, role: 'owner' },
		{ orgId: org, userId: viewer, role: 'viewer' }
	]);
	const ctx = { orgId: org, actor: { id: owner, kind: 'user' as const } };
	return { db, client, org, other, owner, outsider, viewer, ctx };
}

describe('owner member management on Supabase', () => {
	it('rejects duplicate email invites before generating another credential', async () => {
		const f = await setup(),
			userId = randomUUID();
		await asUser(f.db, f.owner, (db) =>
			inviteMember(db, f.ctx, { email: 'member@example.com', role: 'viewer' }, async () => ({
				userId,
				tokenHash: 'first'
			}))
		);
		const generate = vi.fn();
		await expect(
			asUser(f.db, f.owner, (db) =>
				inviteMember(db, f.ctx, { email: 'member@example.com', role: 'owner' }, generate)
			)
		).rejects.toThrow('already a member');
		expect(generate).not.toHaveBeenCalled();
		expect(
			(await f.db.select().from(memberships).where(eq(memberships.userId, userId)))[0].role
		).toBe('viewer');
	});

	it('invites with the chosen org and role, leaves onboarding unset, and audits atomically', async () => {
		const f = await setup(),
			invited = randomUUID();
		const generate = vi.fn(async () => ({ userId: invited, tokenHash: 'test-hash' }));
		const result = await asUser(f.db, f.owner, (db) =>
			inviteMember(db, f.ctx, { email: 'invitee@example.com', role: 'rights_admin' }, generate)
		);
		expect(result.orgName).toBe('Alpha Label');
		expect(generate).toHaveBeenCalledWith('invitee@example.com');
		const [row] = await f.db.select().from(memberships).where(eq(memberships.userId, invited));
		expect(row).toMatchObject({
			orgId: f.org,
			role: 'rights_admin',
			email: 'invitee@example.com',
			onboardedAt: null
		});
		const [audit] = await f.db.select().from(auditLog);
		expect(audit).toMatchObject({
			orgId: f.org,
			actorId: f.owner,
			action: 'invited',
			entity: 'membership',
			entityId: invited,
			after: { email: 'invitee@example.com', role: 'rights_admin' }
		});
		expect(JSON.stringify(audit.after)).not.toContain('test-hash');
	});

	it.each(['viewer', 'outsider'] as const)(
		'refuses %s before generating an auth credential',
		async (who) => {
			const f = await setup(),
				generate = vi.fn();
			await expect(
				asUser(f.db, f[who], (db) =>
					inviteMember(
						db,
						{ ...f.ctx, actor: { id: f[who], kind: 'user' } },
						{ email: 'invitee@example.com', role: 'owner' },
						generate
					)
				)
			).rejects.toThrow();
			expect(generate).not.toHaveBeenCalled();
			expect(await f.db.select().from(auditLog)).toHaveLength(0);
		}
	);

	it('cannot place a member into another org even when the service org parameter is forged', async () => {
		const f = await setup(),
			generate = vi.fn();
		await expect(
			asUser(f.db, f.owner, (db) =>
				inviteMember(
					db,
					{ ...f.ctx, orgId: f.other },
					{ email: 'invitee@example.com', role: 'owner' },
					generate
				)
			)
		).rejects.toThrow();
		expect(generate).not.toHaveBeenCalled();
	});

	it('changes and removes a member with before/after audit entries', async () => {
		const f = await setup();
		await asUser(f.db, f.owner, (db) => changeMember(db, f.ctx, f.viewer, 'catalog_manager'));
		expect(
			(await f.db.select().from(memberships).where(eq(memberships.userId, f.viewer)))[0].role
		).toBe('catalog_manager');
		await asUser(f.db, f.owner, (db) => changeMember(db, f.ctx, f.viewer, null));
		expect(
			await f.db.select().from(memberships).where(eq(memberships.userId, f.viewer))
		).toHaveLength(0);
		expect((await f.db.select().from(auditLog)).map((a) => a.action).sort()).toEqual([
			'removed',
			'role_changed'
		]);
	});

	it.each([null, 'viewer'] as const)(
		'rolls back last-owner removal/demotion (%s), including its audit',
		async (role) => {
			const f = await setup();
			await expect(
				asUser(f.db, f.owner, (db) => changeMember(db, f.ctx, f.owner, role))
			).rejects.toThrow();
			expect(
				(await f.db.select().from(memberships).where(eq(memberships.userId, f.owner)))[0].role
			).toBe('owner');
			expect(await f.db.select().from(auditLog)).toHaveLength(0);
		}
	);

	it('permits an owner to remove themselves when another owner remains', async () => {
		const f = await setup();
		await asUser(f.db, f.owner, (db) => changeMember(db, f.ctx, f.viewer, 'owner'));
		await asUser(f.db, f.owner, (db) => changeMember(db, f.ctx, f.owner, null));
		expect(
			await f.db.select().from(memberships).where(eq(memberships.userId, f.owner))
		).toHaveLength(0);
		expect(
			(await f.db.select().from(auditLog)).some(
				(a) => a.entityId === f.owner && a.action === 'removed'
			)
		).toBe(true);
	});

	it('serializes concurrent owner demotions so one owner survives', async () => {
		const f = await setup();
		await asUser(f.db, f.owner, (db) => changeMember(db, f.ctx, f.viewer, 'owner'));
		const results = await Promise.allSettled([
			asUser(f.db, f.owner, (db) => changeMember(db, f.ctx, f.owner, 'viewer')),
			asUser(f.db, f.viewer, (db) =>
				changeMember(db, { ...f.ctx, actor: { id: f.viewer, kind: 'user' } }, f.viewer, 'viewer')
			)
		]);
		expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
		expect(
			(await f.db.select().from(memberships).where(eq(memberships.orgId, f.org))).filter(
				(m) => m.role === 'owner'
			)
		).toHaveLength(1);
	});

	it('rejects direct app SQL/function writes without an audit entry', async () => {
		const f = await setup();
		await expect(
			asUser(f.db, f.owner, async (db) => {
				await db.execute(
					sql`select app.change_member_role(${f.org}::uuid,${f.viewer}::uuid,'owner'::public.role)`
				);
			})
		).rejects.toThrow();
		expect(
			(await f.db.select().from(memberships).where(eq(memberships.userId, f.viewer)))[0].role
		).toBe('viewer');
	});

	it.each(['anon', 'authenticated'] as const)(
		'refuses direct %s writes and management functions',
		async (role) => {
			const f = await setup();
			const run = (statement: ReturnType<typeof sql>) =>
				f.db.transaction(async (tx) => {
					await tx.execute(
						sql`select set_config('role',${role},true),set_config('request.jwt.claim.sub',${f.owner},true)`
					);
					return tx.execute(statement);
				});
			await expect(
				run(
					sql`insert into memberships(org_id,user_id,role) values(${f.org}::uuid,${randomUUID()}::uuid,'owner')`
				)
			).rejects.toThrow();
			await expect(
				run(
					sql`select app.add_member(${f.org}::uuid,${randomUUID()}::uuid,'fake@example.com','owner')`
				)
			).rejects.toThrow();
			await run(sql`update memberships set role='owner' where user_id=${f.viewer}::uuid`);
			await run(sql`delete from memberships where user_id=${f.viewer}::uuid`);
			expect(
				(await f.db.select().from(memberships).where(eq(memberships.userId, f.viewer)))[0].role
			).toBe('viewer');
		}
	);

	it('blocks direct cross-org updates/deletes and invalid human roles', async () => {
		const f = await setup();
		await expect(
			asUser(f.db, f.owner, (db) => changeMember(db, f.ctx, f.outsider, 'viewer'))
		).rejects.toThrow();
		await expect(
			asUser(f.db, f.owner, (db) => changeMember(db, f.ctx, f.outsider, null))
		).rejects.toThrow();
		await expect(
			asUser(f.db, f.owner, (db) =>
				db.execute(
					sql`select app.change_member_role(${f.org}::uuid,${f.viewer}::uuid,'agent'::public.role)`
				)
			)
		).rejects.toThrow();
		expect(await f.db.select().from(auditLog)).toHaveLength(0);
	});

	it('resends only for the same pending member and never puts credentials in the audit log', async () => {
		const f = await setup(),
			userId = randomUUID();
		await asUser(f.db, f.owner, (db) =>
			inviteMember(db, f.ctx, { email: 'member@example.com', role: 'viewer' }, async () => ({
				userId,
				tokenHash: 'first'
			}))
		);
		const resent = await asUser(f.db, f.owner, (db) =>
			resendInvitation(db, f.ctx, userId, async () => ({ userId, tokenHash: 'second' }))
		);
		expect(resent).toMatchObject({
			email: 'member@example.com',
			orgName: 'Alpha Label',
			tokenHash: 'second'
		});
		expect((await f.db.select().from(auditLog)).map((a) => a.action).sort()).toEqual([
			'invite_resent',
			'invited'
		]);
		await expect(
			asUser(f.db, f.owner, (db) =>
				resendInvitation(db, f.ctx, userId, async () => ({
					userId: randomUUID(),
					tokenHash: 'wrong'
				}))
			)
		).rejects.toThrow();
	});
});
