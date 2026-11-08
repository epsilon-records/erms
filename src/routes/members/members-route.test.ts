import { beforeEach, describe, expect, it, vi } from 'vitest';
import { memberships, orgs } from '#lib/server/db/schema.js';
import { scopedTo } from '#lib/server/db/scoped.js';
import { createTestDb } from '#lib/server/test-db.js';

// A stand-in for Supabase's Auth admin API: records what would have been emailed.
const invite = vi.fn();
vi.mock('#lib/server/auth-admin.js', () => ({
	InviteRefused: class extends Error {},
	authAdmin: () => ({ invite, accounts: async () => new Map() })
}));

const { actions } = await import('./+page.server');

const ownerA = '00000000-0000-7000-8000-0000000000a1';
const ownerB = '00000000-0000-7000-8000-0000000000b1';
const newcomer = '00000000-0000-7000-8000-0000000000c1';

function form(fields: Record<string, string>) {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	return new Request('https://erms.epsilonrecords.com/members?/invite', { method: 'POST', body });
}

describe('members page: invite action', () => {
	let db: Awaited<ReturnType<typeof createTestDb>>['db'];
	let orgA: string;
	let orgB: string;

	const locals = (userId: string, orgId: string, orgName: string) =>
		({
			user: { id: userId },
			membership: { orgId, orgName, role: 'owner' },
			db: scopedTo(db, userId)
		}) as never;

	beforeEach(async () => {
		invite.mockReset();
		({ db } = await createTestDb());
		[{ id: orgA }] = await db.insert(orgs).values({ name: 'Label A', slug: 'a' }).returning();
		[{ id: orgB }] = await db.insert(orgs).values({ name: 'Label B', slug: 'b' }).returning();
		await db.insert(memberships).values([
			{ orgId: orgA, userId: ownerA, role: 'owner' },
			{ orgId: orgB, userId: ownerB, role: 'owner' }
		]);
	});

	it('invites into the owner’s own label, naming that label', async () => {
		invite.mockResolvedValue({ userId: newcomer, emailed: true });
		const out = await actions.invite({
			request: form({ email: 'new@example.test', role: 'rights_admin' }),
			locals: locals(ownerA, orgA, 'Label A')
		} as never);
		expect(out).toMatchObject({ ok: true, result: { outcome: 'added', emailed: true } });
		expect(invite).toHaveBeenCalledWith('new@example.test', 'Label A');
		const rows = await db.select().from(memberships);
		expect(rows.find((r) => r.userId === newcomer)).toMatchObject({
			orgId: orgA,
			role: 'rights_admin'
		});
	});

	it('refuses a cross-org invite before any email is sent', async () => {
		// The session claims org B (a forged cookie or a stale membership); the database says no.
		await expect(
			actions.invite({
				request: form({ email: 'new@example.test', role: 'viewer' }),
				locals: locals(ownerA, orgB, 'Label B')
			} as never)
		).rejects.toMatchObject({ status: 403 });
		expect(invite).not.toHaveBeenCalled();
		expect((await db.select().from(memberships)).length).toBe(2);
	});

	it('rejects a bad address or role without calling Auth', async () => {
		for (const fields of [
			{ email: 'not-an-address', role: 'viewer' },
			{ email: 'new@example.test', role: 'agent' }
		]) {
			const out = await actions.invite({
				request: form(fields),
				locals: locals(ownerA, orgA, 'Label A')
			} as never);
			expect(out).toMatchObject({ status: 400 });
		}
		expect(invite).not.toHaveBeenCalled();
	});
});
