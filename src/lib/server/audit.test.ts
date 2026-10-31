import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { withAudit } from './audit';
import { auditLog, orgs } from './db/schema';
import { createTestDb } from './test-db';

const actor = { id: 'user-1', kind: 'user' as const };

describe('withAudit', () => {
	let db: Awaited<ReturnType<typeof createTestDb>>['db'];
	let orgId: string;

	beforeEach(async () => {
		({ db } = await createTestDb());
		const [org] = await db
			.insert(orgs)
			.values({ name: 'Epsilon Records', slug: 'epsilon' })
			.returning();
		orgId = org.id;
	});

	it('writes the change and its audit entry together', async () => {
		await withAudit(db, { orgId, actor }, async (tx, audit) => {
			const [before] = await tx.select().from(orgs).where(eq(orgs.id, orgId));
			const [after] = await tx
				.update(orgs)
				.set({ name: 'Epsilon' })
				.where(eq(orgs.id, orgId))
				.returning();
			await audit({ entity: 'org', entityId: orgId, action: 'rename', before, after });
		});

		const [org] = await db.select().from(orgs).where(eq(orgs.id, orgId));
		const entries = await db.select().from(auditLog);
		expect(org.name).toBe('Epsilon');
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({ action: 'rename', actorId: 'user-1', actorKind: 'user' });
	});

	it('rolls back the change when the callback throws', async () => {
		await expect(
			withAudit(db, { orgId, actor }, async (tx, audit) => {
				await tx.update(orgs).set({ name: 'Broken' }).where(eq(orgs.id, orgId));
				await audit({ entity: 'org', entityId: orgId, action: 'rename' });
				throw new Error('boom');
			})
		).rejects.toThrow('boom');

		const [org] = await db.select().from(orgs).where(eq(orgs.id, orgId));
		expect(org.name).toBe('Epsilon Records');
		expect(await db.select().from(auditLog)).toHaveLength(0);
	});

	it('rejects a write that records no audit entry', async () => {
		await expect(
			withAudit(db, { orgId, actor }, async (tx) => {
				await tx.update(orgs).set({ name: 'Silent' }).where(eq(orgs.id, orgId));
			})
		).rejects.toThrow(/without an audit entry/);

		const [org] = await db.select().from(orgs).where(eq(orgs.id, orgId));
		expect(org.name).toBe('Epsilon Records');
	});

	it('keeps the audit log append-only', async () => {
		await withAudit(db, { orgId, actor }, async (_tx, audit) => {
			await audit({ entity: 'org', entityId: orgId, action: 'touch' });
		});
		// Drizzle wraps the database error; the trigger's message is on its cause.
		const err = await db.delete(auditLog).catch((e: Error & { cause?: Error }) => e);
		expect(String((err as { cause?: Error }).cause?.message)).toMatch(/append-only/);
		expect(await db.select().from(auditLog)).toHaveLength(1);
	});
});
