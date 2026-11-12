import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import {
	activateDomain,
	cancelDomainRequest,
	cleanUpRetiredDomains,
	DomainError,
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
	async function claim(id: string, domain: string, who = owner) {
		const token = await asUser(db, who, (tx) => requestDomain(tx, id, domain));
		await asUser(db, who, (tx) => activateDomain(tx, id, domain, token));
	}
	const actionsOf = async (id: string) =>
		(await db.select().from(auditLog).where(eq(auditLog.orgId, id))).map((e) => e.action);

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

		await asUser(db, owner, (tx) => activateDomain(tx, id, 'a.example.test', token));
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
			(tx: Parameters<typeof requestDomain>[0]) => activateDomain(tx, id, 'b.example.test', 'x'),
			(tx: Parameters<typeof requestDomain>[0]) => removeDomain(tx, id),
			(tx: Parameters<typeof requestDomain>[0]) => cancelDomainRequest(tx, id),
			(tx: Parameters<typeof requestDomain>[0]) =>
				cleanUpRetiredDomains(tx, id, { configured: true, remove: async () => {} })
		]) {
			await expect(asUser(db, viewer, call)).rejects.toMatchObject({ status: 403 });
		}
	});

	it('cannot activate a domain that was not requested', async () => {
		const id = await label('dom-c');
		await expect(
			asUser(db, owner, (tx) => activateDomain(tx, id, 'c.example.test', 'x'))
		).rejects.toMatchObject({ status: 409 });
	});

	it("a label cannot take another label's active domain", async () => {
		const a = await label('dom-d1');
		await claim(a, 'd.example.test');
		const b = await label('dom-d2', otherOwner);
		await expect(
			asUser(db, otherOwner, (tx) => requestDomain(tx, b, 'd.example.test'))
		).rejects.toMatchObject({ status: 409 });
	});

	it('records a failure; cancel keeps the active domain; remove clears it and returns it', async () => {
		const id = await label('dom-e');
		await claim(id, 'e.example.test');
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
		// The removed domain, and the cancelled request before it, wait on the retired list until
		// they are off Netlify and Supabase Auth.
		expect((await row(id)).domainRetired.sort()).toEqual(['e.example.test', 'e2.example.test']);
	});

	it('cancelling a pending request is audited; cancelling nothing is not', async () => {
		const id = await label('dom-g');
		await asUser(db, owner, (tx) => cancelDomainRequest(tx, id));
		expect(await actionsOf(id)).not.toContain('cancel_domain_request');
		await asUser(db, owner, (tx) => requestDomain(tx, id, 'g.example.test'));
		await asUser(db, owner, (tx) => cancelDomainRequest(tx, id));
		const [entry] = await db
			.select()
			.from(auditLog)
			.where(and(eq(auditLog.orgId, id), eq(auditLog.action, 'cancel_domain_request')));
		expect(entry.before).toMatchObject({ requested: 'g.example.test' });
	});

	it('a pending domain that is cancelled, replaced or removed is retired, not forgotten', async () => {
		// Verification may have added it to Netlify or Supabase Auth before failing or being
		// overtaken, so it must stay reachable by the cleanup.
		const id = await label('dom-n');
		await asUser(db, owner, (tx) => requestDomain(tx, id, 'n1.example.test'));
		await asUser(db, owner, (tx) => cancelDomainRequest(tx, id));
		expect((await row(id)).domainRetired).toEqual(['n1.example.test']);
		await asUser(db, owner, (tx) => requestDomain(tx, id, 'n2.example.test'));
		await asUser(db, owner, (tx) => requestDomain(tx, id, 'n3.example.test'));
		expect((await row(id)).domainRetired.sort()).toEqual(['n1.example.test', 'n2.example.test']);
		await asUser(db, owner, (tx) => removeDomain(tx, id));
		expect((await row(id)).domainRetired.sort()).toEqual([
			'n1.example.test',
			'n2.example.test',
			'n3.example.test'
		]);
		// Requesting it again and activating it takes it back off.
		await claim(id, 'n2.example.test');
		expect((await row(id)).domainRetired.sort()).toEqual(['n1.example.test', 'n3.example.test']);
	});

	it('activates only the request whose token was checked', async () => {
		const id = await label('dom-h');
		const first = await asUser(db, owner, (tx) => requestDomain(tx, id, 'h.example.test'));
		// A second request for the same domain issues a new token while the first check runs.
		const second = await asUser(db, owner, (tx) => requestDomain(tx, id, 'h.example.test'));
		await expect(
			asUser(db, owner, (tx) => activateDomain(tx, id, 'h.example.test', first))
		).rejects.toMatchObject({ status: 409 });
		await asUser(db, owner, (tx) => activateDomain(tx, id, 'h.example.test', second));
		expect((await row(id)).customDomain).toBe('h.example.test');
	});

	it('a move retires the old domain; moving back un-retires it', async () => {
		const id = await label('dom-i');
		await claim(id, 'i1.example.test');
		await claim(id, 'i2.example.test');
		expect(await row(id)).toMatchObject({
			customDomain: 'i2.example.test',
			domainRetired: ['i1.example.test']
		});
		await claim(id, 'i1.example.test');
		expect((await row(id)).domainRetired).toEqual(['i2.example.test']);
	});

	describe('cleaning up retired domains', () => {
		const tracker = (fail: string[] = []) => {
			const removed: string[] = [];
			return {
				removed,
				provision: {
					configured: true,
					async remove(domain: string) {
						if (fail.includes(domain))
							throw new DomainError(502, 'api.netlify.com answered HTTP 500.');
						removed.push(domain);
					}
				}
			};
		};

		it('removes each retired domain from the providers, then from the list', async () => {
			const id = await label('dom-j');
			await claim(id, 'j1.example.test');
			await claim(id, 'j2.example.test');
			await asUser(db, owner, (tx) => removeDomain(tx, id));
			const t = tracker();
			const waiting = await asUser(db, owner, (tx) => cleanUpRetiredDomains(tx, id, t.provision));
			expect(waiting).toEqual([]);
			expect(t.removed.sort()).toEqual(['j1.example.test', 'j2.example.test']);
			expect((await row(id)).domainRetired).toEqual([]);
		});

		it('keeps a domain whose removal failed, and retries it next time', async () => {
			const id = await label('dom-k');
			await claim(id, 'k.example.test');
			await asUser(db, owner, (tx) => removeDomain(tx, id));
			const failing = tracker(['k.example.test']);
			expect(
				await asUser(db, owner, (tx) => cleanUpRetiredDomains(tx, id, failing.provision))
			).toEqual(['k.example.test']);
			expect((await row(id)).domainRetired).toEqual(['k.example.test']);
			const ok = tracker();
			await asUser(db, owner, (tx) => cleanUpRetiredDomains(tx, id, ok.provision));
			expect(ok.removed).toEqual(['k.example.test']);
			expect((await row(id)).domainRetired).toEqual([]);
		});

		it('without provisioning tokens removes nothing and keeps the list', async () => {
			const id = await label('dom-l');
			await claim(id, 'l.example.test');
			await asUser(db, owner, (tx) => removeDomain(tx, id));
			const removed: string[] = [];
			const unconfigured = {
				configured: false,
				remove: async (d: string) => void removed.push(d)
			};
			expect(await asUser(db, owner, (tx) => cleanUpRetiredDomains(tx, id, unconfigured))).toEqual([
				'l.example.test'
			]);
			expect(removed).toEqual([]);
			expect((await row(id)).domainRetired).toEqual(['l.example.test']);
		});

		it('leaves a domain another label now serves on the providers, and only clears the list', async () => {
			const a = await label('dom-m1');
			await claim(a, 'm.example.test');
			await asUser(db, owner, (tx) => removeDomain(tx, a));
			const b = await label('dom-m2', otherOwner);
			await claim(b, 'm.example.test', otherOwner);
			const t = tracker();
			expect(await asUser(db, owner, (tx) => cleanUpRetiredDomains(tx, a, t.provision))).toEqual(
				[]
			);
			expect(t.removed).toEqual([]);
			expect((await row(a)).domainRetired).toEqual([]);
		});
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
