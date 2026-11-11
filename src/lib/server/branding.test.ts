import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { brandForHost, clearBrandCache, DEFAULT_BRAND, normalizeHost } from './branding';
import { orgs } from './db/schema';
import { createTestDb } from './test-db';

describe('normalizeHost', () => {
	it('lowercases and drops the port and a trailing dot', () => {
		expect(normalizeHost('ERMS.EpsilonRecords.com:443')).toBe('erms.epsilonrecords.com');
		expect(normalizeHost('labelkit.co.')).toBe('labelkit.co');
		expect(normalizeHost('')).toBeNull();
		expect(normalizeHost(undefined)).toBeNull();
	});
});

describe('per-customer branding (EPSILON-132)', () => {
	let db: Awaited<ReturnType<typeof createTestDb>>['db'];
	let ermsId: string;

	beforeAll(async () => {
		({ db } = await createTestDb());
		[{ id: ermsId }] = await db
			.insert(orgs)
			.values({
				name: 'Epsilon Records',
				slug: 'brand-epsilon',
				displayName: 'ERMS',
				accentColor: '#c6f432',
				customDomain: 'erms.example.test'
			})
			.returning();
		await db.insert(orgs).values({ name: 'Plain Label', slug: 'brand-plain' });
	});

	beforeEach(() => clearBrandCache());

	it("brands a customer's own domain with its name and accent", async () => {
		expect(await brandForHost(db, 'ERMS.example.test:443')).toEqual({
			name: 'ERMS',
			accent: '#c6f432',
			orgId: ermsId
		});
	});

	it('uses LabelKit everywhere else', async () => {
		expect(await brandForHost(db, 'labelkit.co')).toEqual(DEFAULT_BRAND);
		expect(await brandForHost(db, 'deploy-preview-1--labelkit.netlify.app')).toEqual(DEFAULT_BRAND);
		expect(await brandForHost(db, null)).toEqual(DEFAULT_BRAND);
	});

	it('falls back to the org name when it has a domain but no display name', async () => {
		await db
			.insert(orgs)
			.values({ name: 'Named Only', slug: 'brand-named', customDomain: 'named.example.test' });
		expect((await brandForHost(db, 'named.example.test')).name).toBe('Named Only');
	});

	it('caches per host for a minute', async () => {
		const t = 1_000_000;
		await brandForHost(db, 'late.example.test', t);
		await db
			.insert(orgs)
			.values({ name: 'Late', slug: 'brand-late', customDomain: 'late.example.test' });
		expect((await brandForHost(db, 'late.example.test', t + 30_000)).orgId).toBeNull();
		expect((await brandForHost(db, 'late.example.test', t + 61_000)).name).toBe('Late');
	});

	it('refuses bad branding values in the database', async () => {
		for (const values of [
			{ customDomain: 'ERMS.Example.test' },
			{ customDomain: 'https://x.example.test' },
			{ customDomain: 'erms.example.test' },
			{ accentColor: 'lime' },
			{ accentColor: '#C6F432' },
			{ displayName: '' }
		]) {
			await expect(
				db
					.insert(orgs)
					.values({ name: 'Bad', slug: `bad-${Math.random()}`.slice(0, 20), ...values }),
				JSON.stringify(values)
			).rejects.toThrow();
		}
	});
});
