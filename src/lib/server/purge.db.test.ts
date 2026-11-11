import { eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { auditLog, labels, memberships, orgs, parties } from './db/schema';
import { asUser } from './db/scoped';
import { closeOrg, duePurges, purgeOrg, reopenOrg } from './purge';
import { createTestDb } from './test-db';

const owner = '00000000-0000-7000-8000-0000000000d1';
const viewer = '00000000-0000-7000-8000-0000000000d2';

describe('closing and purging a label', () => {
	let db: Awaited<ReturnType<typeof createTestDb>>['db'];

	beforeAll(async () => {
		({ db } = await createTestDb());
	});

	async function label(slug: string) {
		const [{ id }] = await db.insert(orgs).values({ name: slug, slug }).returning();
		await db.insert(memberships).values([
			{ orgId: id, userId: owner, role: 'owner' },
			{ orgId: id, userId: viewer, role: 'viewer' }
		]);
		await db.insert(labels).values({ orgId: id, name: `${slug} imprint` });
		await db.insert(parties).values({ orgId: id, displayName: 'Someone', matchKey: 'someone' });
		return id;
	}
	const noStorage = { storage: null, revokeClient: null, log: () => {} };

	it('only an owner closes; a reopen within the grace period undoes it', async () => {
		const id = await label('close-a');
		await expect(asUser(db, viewer, (tx) => closeOrg(tx, id))).rejects.toMatchObject({
			status: 403
		});
		const purgeAfter = await asUser(db, owner, (tx) => closeOrg(tx, id));
		expect(purgeAfter.getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 3600 * 1000);
		await asUser(db, owner, (tx) => reopenOrg(tx, id));
		const [row] = await db.select().from(orgs).where(eq(orgs.id, id));
		expect(row.closedAt).toBeNull();
	});

	it('the purge deletes everything the label owns, audit log included, only once due', async () => {
		const id = await label('close-b');
		await asUser(db, owner, (tx) => closeOrg(tx, id));
		// Not due yet: nothing happens.
		expect(await purgeOrg(db, id, noStorage)).toBe(false);
		await db
			.update(orgs)
			.set({ purgeAfter: new Date(Date.now() - 1000) })
			.where(eq(orgs.id, id));
		expect((await duePurges(db)).map((r) => r.id)).toContain(id);
		expect(await purgeOrg(db, id, noStorage)).toBe(true);
		expect(await db.select().from(orgs).where(eq(orgs.id, id))).toEqual([]);
		expect(await db.select().from(parties).where(eq(parties.orgId, id))).toEqual([]);
		expect(await db.select().from(auditLog).where(eq(auditLog.orgId, id))).toEqual([]);
	});

	it('the audit log stays append-only outside a purge', async () => {
		const id = await label('close-c');
		await asUser(db, owner, (tx) => closeOrg(tx, id));
		await expect(
			db.execute(sql`delete from audit_log where org_id = ${id}::uuid`)
		).rejects.toThrow();
		// The app role cannot run the purge at all.
		await expect(
			asUser(db, owner, (tx) => tx.execute(sql`select app.purge_org(${id}::uuid)`))
		).rejects.toThrow();
	});
});
