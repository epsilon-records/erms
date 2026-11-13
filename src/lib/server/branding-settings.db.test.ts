import { and, eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { brandForHost, cachedBrandIcon, clearBrandCache } from './branding';
import { BrandingError, loadBranding, saveBranding } from './branding-settings';
import { auditLog, memberships, orgs } from './db/schema';
import { asUser } from './db/scoped';
import { createTestDb } from './test-db';

const owner = '00000000-0000-7000-8000-0000000000e1';
const viewer = '00000000-0000-7000-8000-0000000000e2';

// A real 1×1 PNG is too small for checkIcon, but the database only checks the PNG signature and
// the size; the route checks dimensions before saving.
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
	'base64'
).toString('base64');

describe('tenant branding settings (migration 0031)', () => {
	let db: Awaited<ReturnType<typeof createTestDb>>['db'];

	beforeAll(async () => {
		({ db } = await createTestDb());
	});
	beforeEach(() => clearBrandCache());

	async function label(slug: string, customDomain?: string) {
		const [{ id }] = await db.insert(orgs).values({ name: slug, slug, customDomain }).returning();
		await db.insert(memberships).values([
			{ orgId: id, userId: owner, role: 'owner' },
			{ orgId: id, userId: viewer, role: 'viewer' }
		]);
		return id;
	}

	it('an owner sets name, accent and icon; the change is audited', async () => {
		const id = await label('brand-set-a');
		await asUser(db, owner, (tx) =>
			saveBranding(tx, id, { displayName: 'Label A', accent: '#123abc', icon: { png: PNG } })
		);
		const b = await asUser(db, owner, (tx) => loadBranding(tx, id));
		expect(b).toMatchObject({ displayName: 'Label A', accent: '#123abc', faviconPng: PNG });

		const [entry] = await db
			.select()
			.from(auditLog)
			.where(and(eq(auditLog.orgId, id), eq(auditLog.action, 'set_branding')));
		expect(entry.actorId).toBe(owner);
		expect(entry.before).toMatchObject({
			display_name: null,
			accent_color: null,
			favicon_bytes: null
		});
		expect(entry.after).toMatchObject({ display_name: 'Label A', accent_color: '#123abc' });
		expect((entry.after as { favicon_bytes: number }).favicon_bytes).toBeGreaterThan(0);
	});

	it('nulls reset every setting to the product default', async () => {
		const id = await label('brand-set-b');
		await asUser(db, owner, (tx) =>
			saveBranding(tx, id, { displayName: 'B', accent: '#000000', icon: { png: PNG } })
		);
		await asUser(db, owner, (tx) =>
			saveBranding(tx, id, { displayName: null, accent: null, icon: 'remove' })
		);
		const [row] = await db.select().from(orgs).where(eq(orgs.id, id));
		expect(row).toMatchObject({ displayName: null, accentColor: null, faviconPng: null });
	});

	it('only an owner can change the branding', async () => {
		const id = await label('brand-set-c');
		await expect(
			asUser(db, viewer, (tx) =>
				saveBranding(tx, id, { displayName: 'Nope', accent: null, icon: 'remove' })
			)
		).rejects.toBeInstanceOf(BrandingError);
		// An owner of one label cannot brand another: not a member there.
		const [{ id: other }] = await db
			.insert(orgs)
			.values({ name: 'brand-set-d', slug: 'brand-set-d' })
			.returning();
		await db
			.insert(memberships)
			.values({ orgId: other, userId: '00000000-0000-7000-8000-0000000000e3', role: 'owner' });
		await expect(
			asUser(db, owner, (tx) =>
				saveBranding(tx, other, { displayName: 'Nope', accent: null, icon: 'remove' })
			)
		).rejects.toMatchObject({ status: 403 });
	});

	it("'keep' leaves an icon another owner saved in between", async () => {
		const id = await label('brand-set-g');
		await asUser(db, owner, (tx) =>
			saveBranding(tx, id, { displayName: null, accent: null, icon: { png: PNG } })
		);
		// A second owner's form, loaded before that upload, saves only an accent change.
		await asUser(db, owner, (tx) =>
			saveBranding(tx, id, { displayName: null, accent: '#abcdef', icon: 'keep' })
		);
		const [row] = await db.select().from(orgs).where(eq(orgs.id, id));
		expect(row).toMatchObject({ accentColor: '#abcdef', faviconPng: PNG });
	});

	it('a save made from a form loaded before another owner saved is refused, not applied', async () => {
		const id = await label('brand-set-h');
		await asUser(db, owner, (tx) =>
			saveBranding(tx, id, { displayName: 'First', accent: '#111111', icon: 'keep' })
		);
		// Owner A's form shows First/#111111. Owner B renames the label meanwhile.
		await asUser(db, owner, (tx) =>
			saveBranding(tx, id, {
				displayName: 'Renamed',
				accent: '#111111',
				icon: 'keep',
				seen: { displayName: 'First', accent: '#111111' }
			})
		);
		// A saves only an accent change; the form still holds the old name.
		await expect(
			asUser(db, owner, (tx) =>
				saveBranding(tx, id, {
					displayName: 'First',
					accent: '#222222',
					icon: 'keep',
					seen: { displayName: 'First', accent: '#111111' }
				})
			)
		).rejects.toMatchObject({ status: 409 });
		const [row] = await db.select().from(orgs).where(eq(orgs.id, id));
		expect(row).toMatchObject({ displayName: 'Renamed', accentColor: '#111111' });

		// Reloaded, A's form sees the new name and the save goes through.
		await asUser(db, owner, (tx) =>
			saveBranding(tx, id, {
				displayName: 'Renamed',
				accent: '#222222',
				icon: 'keep',
				seen: { displayName: 'Renamed', accent: '#111111' }
			})
		);
		const [after] = await db.select().from(orgs).where(eq(orgs.id, id));
		expect(after).toMatchObject({ displayName: 'Renamed', accentColor: '#222222' });
	});

	it('the database refuses an icon that is not PNG, or too large', async () => {
		const id = await label('brand-set-e');
		for (const faviconPng of [Buffer.from('<svg/>').toString('base64'), PNG.padEnd(44_001, 'A')]) {
			await expect(
				asUser(db, owner, (tx) =>
					saveBranding(tx, id, { displayName: null, accent: null, icon: { png: faviconPng } })
				)
			).rejects.toThrow();
		}
	});

	it("the label's domain serves its icon; other hosts have none", async () => {
		const id = await label('brand-set-f', 'icon.example.test');
		await asUser(db, owner, (tx) =>
			saveBranding(tx, id, { displayName: null, accent: null, icon: { png: PNG } })
		);
		const brand = await brandForHost(db, 'icon.example.test');
		expect(brand.favicon).toMatch(/^[0-9a-f]{12}$/);
		expect(cachedBrandIcon('icon.example.test')).toEqual(Buffer.from(PNG, 'base64'));

		expect((await brandForHost(db, 'labelkit.co')).favicon).toBeNull();
		expect(cachedBrandIcon('labelkit.co')).toBeNull();
	});
});
