import { sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApiKey, listApiKeys, resolveApiKey, revokeApiKey } from './api-keys';
import { listMembers } from './members';
import { labels, memberships, orgs } from './db/schema';
import { asUser } from './db/scoped';
import { createTestDb } from './test-db';

const ownerA = '00000000-0000-7000-8000-0000000000f1';
const ownerB = '00000000-0000-7000-8000-0000000000f2';
const viewerA = '00000000-0000-7000-8000-0000000000f3';

describe('API keys (database)', () => {
	let db: Awaited<ReturnType<typeof createTestDb>>['db'];
	let orgA: string;
	let orgB: string;

	beforeAll(async () => {
		({ db } = await createTestDb());
		[{ id: orgA }] = await db.insert(orgs).values({ name: 'Keys A', slug: 'keys-a' }).returning();
		[{ id: orgB }] = await db.insert(orgs).values({ name: 'Keys B', slug: 'keys-b' }).returning();
		await db.insert(memberships).values([
			{ orgId: orgA, userId: ownerA, role: 'owner' },
			{ orgId: orgA, userId: viewerA, role: 'viewer' },
			{ orgId: orgB, userId: ownerB, role: 'owner' }
		]);
		await db.insert(labels).values([
			{ orgId: orgA, name: 'Imprint A' },
			{ orgId: orgB, name: 'Imprint B' }
		]);
	});

	it('an owner creates a key that reads its own label only, as an agent', async () => {
		const { key } = await asUser(db, ownerA, (tx) =>
			createApiKey(tx, orgA, { name: 'Site', scopes: ['catalog:read'] })
		);
		const resolved = await resolveApiKey(db, key);
		expect(resolved).toMatchObject({ orgId: orgA, scopes: ['catalog:read'] });
		const seen = await asUser(db, resolved!.actorId, (tx) => tx.select().from(labels));
		expect(seen.map((l) => l.name)).toEqual(['Imprint A']);
		// The key's agent takes no place in the member list.
		const members = await asUser(db, ownerA, (tx) => listMembers(tx, orgA));
		expect(members.map((m) => m.role)).not.toContain('agent');
	});

	it('only owners create keys, and only for their own label', async () => {
		await expect(
			asUser(db, viewerA, (tx) => createApiKey(tx, orgA, { name: 'x', scopes: ['catalog:read'] }))
		).rejects.toMatchObject({ status: 403 });
		await expect(
			asUser(db, ownerA, (tx) => createApiKey(tx, orgB, { name: 'x', scopes: ['catalog:read'] }))
		).rejects.toMatchObject({ status: 403 });
	});

	it('a revoked key resolves to nothing and its agent loses access', async () => {
		const { id, key } = await asUser(db, ownerA, (tx) =>
			createApiKey(tx, orgA, { name: 'Temp', scopes: ['catalog:read'] })
		);
		const before = await resolveApiKey(db, key);
		expect(await asUser(db, ownerA, (tx) => revokeApiKey(tx, id))).toBe(true);
		expect(await resolveApiKey(db, key)).toBeNull();
		const seen = await asUser(db, before!.actorId, (tx) => tx.select().from(labels));
		expect(seen).toEqual([]);
		const listed = await asUser(db, ownerA, (tx) => listApiKeys(tx, orgA));
		expect(listed.find((k) => k.id === id)?.revokedAt).not.toBeNull();
	});

	it('the app role cannot read key hashes', async () => {
		await expect(
			asUser(db, ownerA, (tx) => tx.execute(sql`select key_sha256 from api_keys`))
		).rejects.toThrow();
	});
});
