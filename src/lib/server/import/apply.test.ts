import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	auditLog,
	credits,
	importRuns,
	orgs,
	recordings,
	releases,
	releaseTracks
} from '../db/schema';
import { createTestDb } from '../test-db';
import { applyImport } from './apply';
import { parseSymphonicInventory } from './symphonic';

const SAMPLE = readFileSync(
	new URL('./__fixtures__/symphonic-sample.csv', import.meta.url),
	'utf8'
);
const actor = { id: 'user-1', kind: 'user' as const };

describe('applyImport', () => {
	let db: Awaited<ReturnType<typeof createTestDb>>['db'];
	let orgId: string;
	const ctx = (dryRun: boolean) => ({
		orgId,
		actor,
		fileName: 'sample.csv',
		fileSha256: 'x'.repeat(64),
		dryRun
	});

	beforeEach(async () => {
		({ db } = await createTestDb());
		const [org] = await db
			.insert(orgs)
			.values({ name: 'Epsilon Records', slug: 'epsilon' })
			.returning();
		orgId = org.id;
	});

	it('dry run reports counts and writes nothing', async () => {
		const result = await applyImport(db, parseSymphonicInventory(SAMPLE), ctx(true));
		expect(result.dryRun).toBe(true);
		expect(result.importRunId).toBeNull();
		expect(result.counts.releases.created).toBe(10);
		expect(await db.select().from(releases)).toHaveLength(0);
		expect(await db.select().from(auditLog)).toHaveLength(0);
	});

	it('imports the catalog with an audit trail', async () => {
		const plan = parseSymphonicInventory(SAMPLE);
		const result = await applyImport(db, plan, ctx(false));

		expect(await db.select().from(releases)).toHaveLength(10);
		expect(await db.select().from(recordings)).toHaveLength(plan.recordings.size);
		expect(await db.select().from(releaseTracks)).toHaveLength(21);
		expect(await db.select().from(importRuns)).toHaveLength(1);
		const createdCredits = await db.select().from(credits);
		expect(createdCredits.every((c) => c.approvedAt != null && c.source === 'symphonicms')).toBe(
			true
		);

		const audit = await db.select().from(auditLog);
		const creates = result.counts;
		const expected =
			creates.labels.created +
			creates.parties.created +
			creates.recordings.created +
			creates.releases.created +
			creates.credits.created +
			10 + // one tracklist entry per release
			1; // the import run
		expect(audit).toHaveLength(expected);
	});

	it('is idempotent: re-importing the same file changes nothing', async () => {
		await applyImport(db, parseSymphonicInventory(SAMPLE), ctx(false));
		const again = await applyImport(db, parseSymphonicInventory(SAMPLE), ctx(false));
		for (const c of Object.values(again.counts)) {
			expect(c.created).toBe(0);
			expect(c.updated).toBe(0);
		}
		expect(await db.select().from(releases)).toHaveLength(10);
		expect(await db.select().from(releaseTracks)).toHaveLength(21);
	});

	it('refuses a plan that has errors', async () => {
		const plan = parseSymphonicInventory('Name\nx\n');
		await expect(applyImport(db, plan, ctx(false))).rejects.toThrow(/has errors/);
	});
});
