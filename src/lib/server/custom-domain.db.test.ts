import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import {
	activateDomain,
	cancelDomainRequest,
	failDomain,
	removeDomain,
	requestDomain
} from './custom-domain';
import { auditLog, memberships, orgs } from './db/schema';
import { asUser } from './db/scoped';
import { createTestDb } from './test-db';

const owner = '00000000-0000-7000-8000-0000000000f1';
const viewer = '00000000-0000-7000-8000-0000000000f2';
const otherOwner = '00000000-0000-7000-8000-0000000000f3';

describe('self-serve custom domains (migration 0032)', () => {
	let db: Awaited<ReturnType<typeof createTestDb>>['db'];

	beforeAll(async () => {
		({ db } = await createTestDb());
	});

	async function label(slug: string, ownerId = owner) {
		const [{ id }] = await db.insert(orgs).values({ name: slug, slug }).returning();
		await db.insert(memberships).values([
			{ orgId: id, userId: ownerId, role: 'owner' },
			{ orgId: id, userId: viewer, role: 'viewer' }
		]);
		return id;
	}
	const row = async (id: string) => (await db.select().from(orgs).where(eq(orgs.id, id)))[0];

	it('request, then activate: the domain becomes the label’s, and both steps are audited', async () => {
		const id = await label('dom-a');
		const token = await asUser(db, owner, (tx) => requestDomain(tx, id, 'a.example.test'));
		expect(token).toMatch(/^[0-9a-f]{32}$/);
		expect(await row(id)).toMatchObject({
			domainRequested: 'a.example.test',
			domainToken: token,
			domainStatus: 'awaiting_dns',
			customDomain: null
		});

		await asUser(db, owner, (tx) => activateDomain(tx, id, 'a.example.test'));
		expect(await row(id)).toMatchObject({
			customDomain: 'a.example.test',
			domainRequested: null,
			domainToken: null,
			domainStatus: 'active'
		});
		const actions = (await db.select().from(auditLog).where(eq(auditLog.orgId, id))).map(
			(e) => e.action
		);
		expect(actions).toEqual(expect.arrayContaining(['request_domain', 'activate_domain']));
	});

	it('only an owner can request, activate or remove', async () => {
		const id = await label('dom-b');
		for (const call of [
			(tx: Parameters<typeof requestDomain>[0]) => requestDomain(tx, id, 'b.example.test'),
			(tx: Parameters<typeof requestDomain>[0]) => activateDomain(tx, id, 'b.example.test'),
			(tx: Parameters<typeof requestDomain>[0]) => removeDomain(tx, id)
		]) {
			await expect(asUser(db, viewer, call)).rejects.toMatchObject({ status: 403 });
		}
	});

	it('cannot activate a domain that was not requested', async () => {
		const id = await label('dom-c');
		await expect(
			asUser(db, owner, (tx) => activateDomain(tx, id, 'c.example.test'))
		).rejects.toMatchObject({ status: 409 });
	});

	it("a label cannot take another label's active domain", async () => {
		const a = await label('dom-d1');
		await asUser(db, owner, (tx) => requestDomain(tx, a, 'd.example.test'));
		await asUser(db, owner, (tx) => activateDomain(tx, a, 'd.example.test'));
		const b = await label('dom-d2', otherOwner);
		await expect(
			asUser(db, otherOwner, (tx) => requestDomain(tx, b, 'd.example.test'))
		).rejects.toMatchObject({ status: 409 });
	});

	it('records a failure; cancel keeps the active domain; remove clears it and returns it', async () => {
		const id = await label('dom-e');
		await asUser(db, owner, (tx) => requestDomain(tx, id, 'e.example.test'));
		await asUser(db, owner, (tx) => activateDomain(tx, id, 'e.example.test'));
		await asUser(db, owner, (tx) => requestDomain(tx, id, 'e2.example.test'));
		await asUser(db, owner, (tx) => failDomain(tx, id, 'e2.example.test', 'No TXT record yet.'));
		expect(await row(id)).toMatchObject({
			domainStatus: 'failed',
			domainError: 'No TXT record yet.'
		});

		await asUser(db, owner, (tx) => cancelDomainRequest(tx, id));
		expect(await row(id)).toMatchObject({
			customDomain: 'e.example.test',
			domainRequested: null,
			domainStatus: 'active',
			domainError: null
		});

		expect(await asUser(db, owner, (tx) => removeDomain(tx, id))).toBe('e.example.test');
		expect(await row(id)).toMatchObject({ customDomain: null, domainStatus: null });
		const [removed] = await db
			.select()
			.from(auditLog)
			.where(and(eq(auditLog.orgId, id), eq(auditLog.action, 'remove_domain')));
		expect(removed.before).toMatchObject({ domain: 'e.example.test' });
	});

	it('the database refuses a malformed domain or status', async () => {
		const id = await label('dom-f');
		await expect(
			asUser(db, owner, (tx) => requestDomain(tx, id, 'Not A Domain'))
		).rejects.toThrow();
		await expect(
			db.update(orgs).set({ domainStatus: 'live' }).where(eq(orgs.id, id))
		).rejects.toThrow();
	});
});
