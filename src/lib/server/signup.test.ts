import { eq, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { auditLog, memberships, orgs } from './db/schema';
import { asUser } from './db/scoped';
import { createLabel, labelForm } from './signup';
import { slugFromName } from '../slug';
import { createTestDb } from './test-db';

describe('slugFromName', () => {
	it('suggests a valid address from a label name', () => {
		expect(slugFromName('Épsilon Records')).toBe('epsilon-records');
		expect(slugFromName('  --Nieuwe  Groove!! ')).toBe('nieuwe-groove');
		expect(slugFromName('x'.repeat(60))).toHaveLength(40);
		for (const name of ['Épsilon Records', 'A & B', 'diVerse Records', 'a-'.repeat(30)]) {
			expect(labelForm.shape.slug.safeParse(slugFromName(name)).success).toBe(true);
		}
	});
});

describe('labelForm', () => {
	it('accepts a name and a valid address, and refuses bad ones', () => {
		expect(labelForm.safeParse({ name: ' Label ', slug: 'Label-1' }).data).toEqual({
			name: 'Label',
			slug: 'label-1'
		});
		for (const slug of ['', '-a', 'a-', 'a_b', 'a'.repeat(41), 'é']) {
			expect(labelForm.safeParse({ name: 'L', slug }).success, slug).toBe(false);
		}
		expect(labelForm.safeParse({ name: '  ', slug: 'ok' }).success).toBe(false);
	});
});

describe('self-serve label creation (EPSILON-130)', () => {
	let db: Awaited<ReturnType<typeof createTestDb>>['db'];
	const alice = '00000000-0000-7000-8000-00000000c0a1';
	const bob = '00000000-0000-7000-8000-00000000c0b0';
	const heavy = '00000000-0000-7000-8000-00000000c0f3';

	beforeAll(async () => {
		({ db } = await createTestDb());
	});

	it('creates the org, makes the caller its owner and audits it', async () => {
		const result = await asUser(db, alice, (tx) =>
			createLabel(tx, { name: 'Alice Records', slug: 'alice' })
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const [org] = await db.select().from(orgs).where(eq(orgs.id, result.orgId));
		expect(org).toMatchObject({ name: 'Alice Records', slug: 'alice' });
		const members = await db.select().from(memberships).where(eq(memberships.orgId, result.orgId));
		expect(members).toEqual([
			expect.objectContaining({ userId: alice, role: 'owner', onboardedAt: null })
		]);
		const audit = await db.select().from(auditLog).where(eq(auditLog.orgId, result.orgId));
		expect(audit).toEqual([
			expect.objectContaining({
				actorId: alice,
				actorKind: 'user',
				entity: 'org',
				action: 'create_org'
			})
		]);
	});

	it('shows the new label to its owner only', async () => {
		const seen = (user: string) =>
			asUser(db, user, (tx) => tx.select({ slug: orgs.slug }).from(orgs));
		expect((await seen(alice)).map((o) => o.slug)).toEqual(['alice']);
		expect(await seen(bob)).toEqual([]);
	});

	it('refuses a taken address without breaking the transaction', async () => {
		const out = await asUser(db, bob, async (tx) => {
			const taken = await createLabel(tx, { name: 'Copycat', slug: 'alice' });
			const after = await createLabel(tx, { name: 'Bob Beats', slug: 'bob' });
			return { taken, after };
		});
		expect(out.taken).toEqual({ ok: false, reason: 'slug_taken' });
		expect(out.after.ok).toBe(true);
	});

	it('refuses an invalid name or address in the database too', async () => {
		for (const input of [
			{ name: ' ', slug: 'blank-name' },
			{ name: 'Bad', slug: 'Bad Slug' }
		]) {
			expect(await asUser(db, bob, (tx) => createLabel(tx, input))).toEqual({
				ok: false,
				reason: 'invalid'
			});
		}
	});

	it('caps an account at three owned labels', async () => {
		for (const n of [1, 2, 3]) {
			const r = await asUser(db, heavy, (tx) =>
				createLabel(tx, { name: `Heavy ${n}`, slug: `heavy-${n}` })
			);
			expect(r.ok).toBe(true);
		}
		expect(
			await asUser(db, heavy, (tx) => createLabel(tx, { name: 'Heavy 4', slug: 'heavy-4' }))
		).toEqual({ ok: false, reason: 'limit' });
	});

	it('refuses a caller with no user id', async () => {
		const err = await db
			.transaction(async (tx) => {
				await tx.execute(sql`select set_config('role', 'erms_app', true)`);
				await tx.execute(sql`select app.create_org(gen_random_uuid(), 'Nobody', 'nobody')`);
			})
			.then(
				() => null,
				(e) => e as { cause?: { code?: string } }
			);
		expect(err?.cause?.code).toBe('42501');
	});

	it('keeps app.create_org away from anon and authenticated', async () => {
		for (const role of ['anon', 'authenticated']) {
			const [row] = await db.execute<{ ok: boolean }>(
				sql`select has_function_privilege(${role}, 'app.create_org(uuid, text, text)', 'execute') as ok`
			);
			expect(row.ok, role).toBe(false);
		}
	});
});
