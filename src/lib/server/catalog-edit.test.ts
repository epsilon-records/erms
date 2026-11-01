import { readFileSync } from 'node:fs';
import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	addCredit,
	approveCredit,
	EditError,
	removeCredit,
	renameParty,
	updateRecording,
	updateRelease
} from './catalog-edit';
import { auditLog, credits, orgs, parties, recordings, releases } from './db/schema';
import { applyImport } from './import/apply';
import { parseSymphonicInventory } from './import/symphonic';
import { createTestDb } from './test-db';

const SAMPLE = readFileSync(
	new URL('./import/__fixtures__/symphonic-sample.csv', import.meta.url),
	'utf8'
);
const actor = { id: 'user-1', kind: 'user' as const };

async function rejects(p: Promise<unknown>, field: string) {
	const err = await p.catch((e) => e);
	expect(err).toBeInstanceOf(EditError);
	expect(Object.keys((err as EditError).fields)).toContain(field);
}

describe('catalog edits', () => {
	let db: Awaited<ReturnType<typeof createTestDb>>['db'];
	let orgId: string;
	let ctx: { orgId: string; actor: typeof actor };

	const release = async (upc: string) =>
		(await db.select().from(releases).where(eq(releases.upc, upc)))[0];
	const recording = async (isrc: string) =>
		(await db.select().from(recordings).where(eq(recordings.isrc, isrc)))[0];
	const auditCount = async () => (await db.select().from(auditLog)).length;
	const releaseForm = (r: typeof releases.$inferSelect, patch: Record<string, string> = {}) => ({
		title: r.title,
		versionTitle: r.versionTitle ?? '',
		type: r.type,
		releaseDate: r.releaseDate ?? '',
		catalogNumber: r.catalogNumber ?? '',
		upc: r.upc,
		labelId: r.labelId,
		genre: r.genre ?? '',
		subgenre: r.subgenre ?? '',
		...patch
	});

	beforeEach(async () => {
		({ db } = await createTestDb());
		const [org] = await db.insert(orgs).values({ name: 'Epsilon Records', slug: 'e' }).returning();
		orgId = org.id;
		ctx = { orgId, actor };
		await applyImport(db, parseSymphonicInventory(SAMPLE), {
			...ctx,
			fileName: 'f',
			fileSha256: 'x',
			dryRun: false
		});
	});

	it('edits a release and audits only the changed fields', async () => {
		const r = await release('000123450102');
		const before = await auditCount();
		const res = await updateRelease(
			db,
			ctx,
			r.id,
			releaseForm(r, { type: 'ep', versionTitle: 'EP' }),
			r.updatedAt.toISOString()
		);
		expect(res.changed).toBe(true);
		expect((await release('000123450102')).type).toBe('ep');
		const entries = await db.select().from(auditLog).where(eq(auditLog.action, 'edit'));
		expect(entries).toHaveLength(1);
		expect(entries[0].before).toEqual({ type: 'single', versionTitle: null });
		expect(entries[0].after).toEqual({ type: 'ep', versionTitle: 'EP' });
		expect(await auditCount()).toBe(before + 1);
	});

	it('saving an unchanged form writes nothing', async () => {
		const r = await release('000123450102');
		const before = await auditCount();
		const res = await updateRelease(db, ctx, r.id, releaseForm(r), r.updatedAt.toISOString());
		expect(res.changed).toBe(false);
		expect(await auditCount()).toBe(before);
	});

	it('refuses a stale edit', async () => {
		const r = await release('000123450102');
		const stale = r.updatedAt.toISOString();
		await updateRelease(db, ctx, r.id, releaseForm(r, { title: 'Kinetic I' }), stale);
		await rejects(
			updateRelease(db, ctx, r.id, releaseForm(r, { title: 'Kinetic II' }), stale),
			'form'
		);
		expect((await release('000123450102')).title).toBe('Kinetic I');
	});

	it('validates UPCs and keeps them unique', async () => {
		const r = await release('000123450102');
		const fresh = r.updatedAt.toISOString();
		await rejects(
			updateRelease(db, ctx, r.id, releaseForm(r, { upc: '000123450103' }), fresh),
			'upc'
		);
		await rejects(
			updateRelease(db, ctx, r.id, releaseForm(r, { upc: '000123450096' }), fresh),
			'upc'
		);
	});

	it('edits a recording: ISRC normalized, duration from mm:ss', async () => {
		const rec = await recording('ZZAA42285966'); // Spindrome, no duration in the export
		await updateRecording(
			db,
			ctx,
			rec.id,
			{
				title: rec.title,
				versionTitle: '',
				isrc: 'zz-aa4-22-85966',
				duration: '05:12',
				genre: 'Dance',
				subgenre: 'Techno'
			},
			rec.updatedAt.toISOString()
		);
		const after = await recording('ZZAA42285966');
		expect(after.durationMs).toBe(312_000);
		await rejects(
			updateRecording(
				db,
				ctx,
				rec.id,
				{ title: '', versionTitle: '', isrc: 'bad', duration: '5 min', genre: '', subgenre: '' },
				after.updatedAt.toISOString()
			),
			'isrc'
		);
	});

	it('adds a pending credit, creating the artist, then approves it', async () => {
		const rec = await recording('ZZAA12595068');
		const credit = await addCredit(
			db,
			ctx,
			{ recordingId: rec.id },
			{ name: 'New Remixer', role: 'producer' }
		);
		expect(credit.approvedAt).toBeNull();
		expect(credit.source).toBe('manual');
		expect(
			await db.select().from(parties).where(eq(parties.displayName, 'New Remixer'))
		).toHaveLength(1);

		await rejects(
			addCredit(db, ctx, { recordingId: rec.id }, { name: 'new remixer', role: 'producer' }),
			'name'
		);

		await approveCredit(db, ctx, credit.id);
		const [approved] = await db.select().from(credits).where(eq(credits.id, credit.id));
		expect(approved.approvedBy).toBe('user-1');
	});

	it('removes credits but never the last main artist', async () => {
		const rec = await recording('ZZAA12595068');
		const [main] = await db
			.select()
			.from(credits)
			.where(and(eq(credits.recordingId, rec.id), eq(credits.role, 'main')));
		await rejects(removeCredit(db, ctx, main.id), 'form');

		const extra = await addCredit(
			db,
			ctx,
			{ recordingId: rec.id },
			{ name: 'Guest', role: 'main' }
		);
		await removeCredit(db, ctx, extra.id);
		const deleted = await db.select().from(auditLog).where(eq(auditLog.action, 'delete'));
		expect(deleted).toHaveLength(1);
	});

	it('renames an artist and blocks name collisions', async () => {
		const [jody] = await db.select().from(parties).where(eq(parties.displayName, 'Jade Vorn'));
		await renameParty(db, ctx, jody.id, { displayName: 'Jade  Vorn ' });
		await renameParty(db, ctx, jody.id, { displayName: 'JADE VORN' });
		const [renamed] = await db.select().from(parties).where(eq(parties.id, jody.id));
		expect(renamed.displayName).toBe('JADE VORN');
		await rejects(renameParty(db, ctx, jody.id, { displayName: 'Vexo Rand' }), 'displayName');
	});

	it('cannot touch another org', async () => {
		const [other] = await db.insert(orgs).values({ name: 'Other', slug: 'o' }).returning();
		const r = await release('000123450102');
		await rejects(
			updateRelease(
				db,
				{ orgId: other.id, actor },
				r.id,
				releaseForm(r),
				r.updatedAt.toISOString()
			),
			'form'
		);
	});
});
