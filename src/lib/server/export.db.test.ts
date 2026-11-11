import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { memberships, orgs, parties } from './db/schema';
import { asUser } from './db/scoped';
import { EXPORT_FORMAT, exportCatalog } from './export';
import { applyImport } from './import/apply';
import { parseSymphonicInventory } from './import/symphonic';
import { createTestDb } from './test-db';

const SAMPLE = readFileSync(
	new URL('./import/__fixtures__/symphonic-sample.csv', import.meta.url),
	'utf8'
);
const ownerA = '00000000-0000-7000-8000-0000000000e1';
const ownerB = '00000000-0000-7000-8000-0000000000e2';

describe('catalogue export', () => {
	let db: Awaited<ReturnType<typeof createTestDb>>['db'];
	let orgA: string;
	let orgB: string;

	beforeAll(async () => {
		({ db } = await createTestDb());
		[{ id: orgA }] = await db
			.insert(orgs)
			.values({ name: 'Export A', slug: 'export-a' })
			.returning();
		[{ id: orgB }] = await db
			.insert(orgs)
			.values({ name: 'Export B', slug: 'export-b' })
			.returning();
		await db.insert(memberships).values([
			{ orgId: orgA, userId: ownerA, role: 'owner' },
			{ orgId: orgB, userId: ownerB, role: 'owner' }
		]);
		await asUser(db, ownerA, (tx) =>
			applyImport(tx, parseSymphonicInventory(SAMPLE), {
				orgId: orgA,
				actor: { id: ownerA, kind: 'user' },
				fileName: 'sample.csv',
				fileSha256: 'e'.repeat(64),
				dryRun: false
			})
		);
		await db
			.insert(parties)
			.values({ orgId: orgB, displayName: 'Only In B', matchKey: 'only in b' });
	});

	it("exports the label's own catalogue, and nothing of another label's", async () => {
		const out = await asUser(db, ownerA, (tx) => exportCatalog(tx, { id: orgA, name: 'Export A' }));
		expect(out.format).toBe(EXPORT_FORMAT);
		expect(out.tables.releases.length).toBeGreaterThan(0);
		expect(out.tables.recordings.length).toBeGreaterThan(0);
		const everyRow = Object.values(out.tables).flat() as Array<{ orgId?: string }>;
		expect(everyRow.every((row) => row.orgId === undefined || row.orgId === orgA)).toBe(true);
		expect(out.tables.parties.map((p) => p.displayName)).not.toContain('Only In B');
	});

	it("returns nothing when asked for a label the user isn't in", async () => {
		const out = await asUser(db, ownerA, (tx) => exportCatalog(tx, { id: orgB, name: 'Export B' }));
		expect(Object.values(out.tables).every((rows) => rows.length === 0)).toBe(true);
	});
});
