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
			{ orgId: orgB, displayName: 'Vexo Rand Tribute', matchKey: 'vexo rand tribute' }
		]);
	});

	it('finds releases and recordings by artist name, as word prefixes', async () => {
		const r = await search('vex ra');
		expect(r.artists.map((a) => a.name)).toEqual(['Vexo Rand']);
		expect(r.releases.map((x) => x.title)).toContain('THE PLATEAU');
		expect(r.recordings.map((x) => x.title)).toEqual(
			expect.arrayContaining(['ARGON DAWN', 'FIZZ SNAP', 'THE PLATEAU'])
		);
		expect(r.releases[0].artists).toEqual(['Vexo Rand']);
	});

	it('needs every word to match', async () => {
		const r = await search('vexo lantern');
		expect(r.releases).toEqual([]);
		expect(r.recordings).toEqual([]);
	});

	it('ignores case and accents', async () => {
		expect((await search('RHONE')).artists.map((a) => a.name)).toEqual(['Rhône Collective']);
		expect((await search('rhône')).artists.map((a) => a.name)).toEqual(['Rhône Collective']);
		expect((await search('argon dawn')).recordings.map((x) => x.isrc)).toEqual(['ZZAA12510374']);
	});

	it('finds remixes by remixer and by mix name', async () => {
		const byRemixer = await search('sable');
		expect(byRemixer.recordings.some((x) => x.versionTitle === 'Rook Sable Remix')).toBe(true);
		const byMix = await search('extended mix');
		expect(byMix.recordings.length).toBeGreaterThanOrEqual(2);
	});

	it('matches identifiers with or without separators, exact match first', async () => {
		const isrc = await search('zz-aa1-25-95068');
		expect(isrc.recordings[0].isrc).toBe('ZZAA12595068');

		const upc = await search('000123450102');
		expect(upc.releases.map((x) => x.title)).toEqual(['Kinetic']);

		const cat = await search('cat 9000006');
		expect(cat.releases[0].title).toBe('THE PLATEAU');

		// A prefix of an ISRC finds every recording that starts with it.
		const prefix = await search('ZZAA125950');
		expect(prefix.recordings.map((x) => x.isrc).sort()).toEqual([
			'ZZAA12595068',
			'ZZAA12595078',
			'ZZAA12595083'
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
