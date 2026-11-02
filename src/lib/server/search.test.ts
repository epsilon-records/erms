import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { memberships, orgs, parties } from './db/schema';
import { asUser } from './db/scoped';
import { applyImport } from './import/apply';
import { parseSymphonicInventory } from './import/symphonic';
import { normalizeQuery, searchCatalog } from './search';
import { createTestDb } from './test-db';

const SAMPLE = readFileSync(
	new URL('./import/__fixtures__/symphonic-sample.csv', import.meta.url),
	'utf8'
);

const ownerA = '00000000-0000-7000-8000-00000000000a';
const ownerB = '00000000-0000-7000-8000-00000000000b';

describe('catalog search', () => {
	let db: Awaited<ReturnType<typeof createTestDb>>['db'];
	let orgA: string;
	let orgB: string;
	/** Search as owner A, through RLS, the way routes do. */
	const search = (q: string, orgId = orgA) =>
		asUser(db, ownerA, (tx) => searchCatalog(tx, orgId, q));

	beforeAll(async () => {
		({ db } = await createTestDb());
		[{ id: orgA }] = await db.insert(orgs).values({ name: 'Label A', slug: 'a' }).returning();
		[{ id: orgB }] = await db.insert(orgs).values({ name: 'Label B', slug: 'b' }).returning();
		await db.insert(memberships).values([
			{ orgId: orgA, userId: ownerA, role: 'owner' },
			{ orgId: orgB, userId: ownerB, role: 'owner' }
		]);
		const plan = parseSymphonicInventory(SAMPLE);
		await asUser(db, ownerA, (tx) =>
			applyImport(tx, plan, {
				orgId: orgA,
				actor: { id: ownerA, kind: 'user' },
				fileName: 'sample.csv',
				fileSha256: 'a'.repeat(64),
				dryRun: false
			})
		);
		await db.insert(parties).values([
			{ orgId: orgA, displayName: 'Rhône Collective', matchKey: 'rhône collective' },
			// Only in label B: must never show up for A.
			{ orgId: orgB, displayName: 'Vozz Rich Tribute', matchKey: 'vozz rich tribute' }
		]);
	});

	it('finds releases and recordings by artist name, as word prefixes', async () => {
		const r = await search('voz ri');
		expect(r.artists.map((a) => a.name)).toEqual(['Vozz Rich']);
		expect(r.releases.map((x) => x.title)).toContain('THE SUMMIT');
		expect(r.recordings.map((x) => x.title)).toEqual(
			expect.arrayContaining(['NEON SUN', 'BUZZ CLAP', 'THE SUMMIT'])
		);
		expect(r.releases[0].artists).toEqual(['Vozz Rich']);
	});

	it('needs every word to match', async () => {
		const r = await search('vozz beacon');
		expect(r.releases).toEqual([]);
		expect(r.recordings).toEqual([]);
	});

	it('ignores case and accents', async () => {
		expect((await search('RHONE')).artists.map((a) => a.name)).toEqual(['Rhône Collective']);
		expect((await search('rhône')).artists.map((a) => a.name)).toEqual(['Rhône Collective']);
		expect((await search('neon sun')).recordings.map((x) => x.isrc)).toEqual(['QZWV32510374']);
	});

	it('finds remixes by remixer and by mix name', async () => {
		const byRemixer = await search('sibley');
		expect(byRemixer.recordings.some((x) => x.versionTitle === 'Rich Sibley Remix')).toBe(true);
		const byMix = await search('extended mix');
		expect(byMix.recordings.length).toBeGreaterThanOrEqual(2);
	});

	it('matches identifiers with or without separators, exact match first', async () => {
		const isrc = await search('qz-wv3-25-95068');
		expect(isrc.recordings[0].isrc).toBe('QZWV32595068');

		const upc = await search('199502192921');
		expect(upc.releases.map((x) => x.title)).toEqual(['Static']);

		const cat = await search('cat 1380508');
		expect(cat.releases[0].title).toBe('THE SUMMIT');

		// A prefix of an ISRC finds every recording that starts with it.
		const prefix = await search('QZWV325950');
		expect(prefix.recordings.map((x) => x.isrc).sort()).toEqual([
			'QZWV32595068',
			'QZWV32595078',
			'QZWV32595083'
		]);
	});

	it('finds a release by label name', async () => {
		const r = await search('epsilon records');
		expect(r.releases.length).toBeGreaterThan(0);
	});

	it('returns nothing for empty, punctuation-only or unmatched queries', async () => {
		for (const q of ['', '   ', '!!! --- ???', 'zzzznotathing', "'; drop table releases; --"]) {
			const r = await search(q);
			expect([...r.releases, ...r.recordings, ...r.artists], q).toEqual([]);
		}
	});

	it('stays inside the label', async () => {
		const own = await search('tribute');
		expect(own.artists).toEqual([]);
		// Even asking for label B's id as owner A returns nothing: RLS refuses the rows.
		const other = await search('tribute', orgB);
		expect(other.artists).toEqual([]);
	});

	it('normalizes and caps the query', () => {
		expect(normalizeQuery('  a \n  b  ')).toBe('a b');
		expect(normalizeQuery('x'.repeat(500))).toHaveLength(120);
		expect(normalizeQuery(null)).toBe('');
	});
});
