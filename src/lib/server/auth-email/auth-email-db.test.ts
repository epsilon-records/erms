import { describe, expect, it } from 'vitest';
import { orgs, memberships } from '../db/schema';
import { createTestDb } from '../test-db';

// Migration 0025 (EPSILON-147): the Send Email hook reads one account's org ids, as a role that
// can do nothing else.
const U1 = '6f1c2b8e-1c1a-4d55-9a57-0b1f1b0a5c11';
const U2 = '6f1c2b8e-1c1a-4d55-9a57-0b1f1b0a5c22';
const NOBODY = '6f1c2b8e-1c1a-4d55-9a57-0b1f1b0a5c33';

describe('erms_auth_email', () => {
	it('is a role that cannot log in or bypass RLS', async () => {
		const { client } = await createTestDb();
		const [role] =
			await client`select rolcanlogin, rolbypassrls from pg_roles where rolname = 'erms_auth_email'`;
		expect(role).toEqual({ rolcanlogin: false, rolbypassrls: false });
	});

	it('reads exactly one account’s org ids, sorted, and nothing for an address with no membership', async () => {
		const { db, client } = await createTestDb();
		const [a] = await db.insert(orgs).values({ name: 'Epsilon', slug: 'epsilon' }).returning();
		const [b] = await db.insert(orgs).values({ name: 'Label B', slug: 'b' }).returning();
		await db.insert(memberships).values([
			{ orgId: a.id, userId: U1, role: 'owner' },
			{ orgId: b.id, userId: U1, role: 'viewer' },
			{ orgId: b.id, userId: U2, role: 'owner' }
		]);
		const ids = (user: string) =>
			client.begin(async (tx) => {
				await tx`set local role erms_auth_email`;
				const rows =
					await tx`select unnest(app_auth_email.member_org_ids(${user}::uuid))::text as id`;
				return rows.map((r) => r.id);
			});
		expect(await ids(U1)).toEqual([a.id, b.id].sort());
		expect(await ids(U2)).toEqual([b.id]);
		expect(await ids(NOBODY)).toEqual([]);
	});

	it('has no table rights of its own', async () => {
		const { client } = await createTestDb();
		for (const probe of [
			'select * from public.memberships',
			'select * from public.orgs',
			'select * from public.labels'
		]) {
			await expect(
				client.begin(async (tx) => {
					await tx`set local role erms_auth_email`;
					await tx.unsafe(probe);
				})
			).rejects.toMatchObject({ code: '42501' });
		}
	});

	it('is the only role besides the owner that may call the lookup', async () => {
		const { client } = await createTestDb();
		for (const role of [
			'anon',
			'authenticated',
			'service_role',
			'labelkit_app',
			'erms_metrics_ingest'
		]) {
			const [row] =
				await client`select has_function_privilege(${role}, 'app_auth_email.member_org_ids(uuid)', 'execute') as ok`;
			expect(row.ok, role).toBe(false);
		}
		const [row] =
			await client`select has_function_privilege('erms_auth_email', 'app_auth_email.member_org_ids(uuid)', 'execute') as ok`;
		expect(row.ok).toBe(true);
	});
});
