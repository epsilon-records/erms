import { readFileSync } from 'node:fs';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from './audit';
import { EditError, type EditCtx } from './catalog-edit';
import {
	authorizationDecisions,
	compositionWriters,
	labels,
	memberships,
	orgs,
	parties,
	recordings,
	rightsShares
} from './db/schema';
import { asUser } from './db/scoped';
import { applyImport } from './import/apply';
import { parseSymphonicInventory } from './import/symphonic';
import {
	authorize,
	claimMastersForLabel,
	createAgreement,
	createComposition,
	grantConsent,
	isValidIswc,
	getComposition,
	listCompositions,
	masterCoverage,
	normalizeIswc,
	ownershipFor,
	setRecordingLink,
	updateComposition,
	writersFromForm,
	parseShare,
	revokeConsent,
	setOwnership,
	setWriters
} from './rights';
import { createTestDb } from './test-db';

const SAMPLE = readFileSync(
	new URL('./import/__fixtures__/symphonic-sample.csv', import.meta.url),
	'utf8'
);

const owner = '00000000-0000-7000-8000-00000000000a';
const rightsAdmin = '00000000-0000-7000-8000-0000000000a1';
const catalogManager = '00000000-0000-7000-8000-0000000000a2';
const viewer = '00000000-0000-7000-8000-0000000000a3';
const agent = '00000000-0000-7000-8000-0000000000a4';

/** The Postgres message behind Drizzle's wrapper, or '' if it didn't fail. */
async function failure(p: Promise<unknown>) {
	const err = (await p.then(
		() => null,
		(e) => e
	)) as { cause?: { message?: string }; message?: string } | null;
	return err?.cause?.message ?? err?.message ?? '';
}

describe('rights and contracts', () => {
	let db: Awaited<ReturnType<typeof createTestDb>>['db'];
	let orgId: string;
	let labelId: string;
	let vexo: string;
	let emy: string;
	let neonSun: string; // ZZAA12510374, main artist Vexo Rand
	const ctx = (id: string): EditCtx => ({ orgId, actor: { id, kind: 'user' } });
	const as = <T>(user: string, fn: (tx: Database) => Promise<T>) => asUser(db, user, fn);

	beforeAll(async () => {
		({ db } = await createTestDb());
		[{ id: orgId }] = await db.insert(orgs).values({ name: 'Epsilon', slug: 'e' }).returning();
		await db.insert(memberships).values([
			{ orgId, userId: owner, role: 'owner' },
			{ orgId, userId: rightsAdmin, role: 'rights_admin' },
			{ orgId, userId: catalogManager, role: 'catalog_manager' },
			{ orgId, userId: viewer, role: 'viewer' },
			{ orgId, userId: agent, role: 'agent' }
		]);
		await as(owner, (tx) =>
			applyImport(tx, parseSymphonicInventory(SAMPLE), {
				orgId,
				actor: { id: owner, kind: 'user' },
				fileName: 'sample.csv',
				fileSha256: 'a'.repeat(64),
				dryRun: false
			})
		);
		[{ id: labelId }] = await db
			.select({ id: labels.id })
			.from(labels)
			.where(and(eq(labels.orgId, orgId), eq(labels.name, 'Epsilon Records')));
		[{ id: vexo }] = await db
			.select({ id: parties.id })
			.from(parties)
			.where(eq(parties.displayName, 'Vexo Rand'));
		[{ id: emy }] = await db
			.select({ id: parties.id })
			.from(parties)
			.where(eq(parties.displayName, 'Ema Stone'));
		[{ id: neonSun }] = await db
			.select({ id: recordings.id })
			.from(recordings)
			.where(eq(recordings.isrc, 'ZZAA12510374'));
	});

	describe('helpers', () => {
		it('parses shares exactly', () => {
			expect(parseShare('100')).toBe(1_000_000);
			expect(parseShare('33.3333')).toBe(333_333);
			for (const bad of ['0', '100.0001', '-5', '1e2', '33.33333', 'abc', '']) {
				expect(parseShare(bad), bad).toBeNull();
			}
		});

		it('validates ISWC check digits', () => {
			expect(normalizeIswc('T-034.524.680-1')).toBe('T0345246801');
			expect(isValidIswc('T0345246801')).toBe(true);
			expect(isValidIswc('T0345246802')).toBe(false);
			expect(normalizeIswc('  ')).toBeNull();
		});
	});

	describe('ownership', () => {
		it('authorize() refuses everything before ownership is recorded', async () => {
			const d = await as(catalogManager, (tx) => authorize(tx, orgId, neonSun, 'analysis'));
			expect(d.allowed).toBe(false);
			expect(d.reasons).toEqual(['master_incomplete', 'not_controlled']);
		});

		it('rejects splits that do not total 100, and duplicate holders', async () => {
			const bad = [
				[
					{ labelId, share: '60' },
					{ partyId: vexo, share: '30' }
				],
				[
					{ labelId, share: '50' },
					{ labelId, share: '50' }
				]
			];
			for (const holders of bad) {
				await expect(
					as(rightsAdmin, (tx) =>
						setOwnership(tx, ctx(rightsAdmin), {
							right: 'master',
							targetId: neonSun,
							territory: 'WW',
							holders
						})
					)
				).rejects.toBeInstanceOf(EditError);
			}
		});

		it('the database enforces 100% even if the app is bypassed', async () => {
			const msg = await failure(
				as(rightsAdmin, (tx) =>
					tx.insert(rightsShares).values({
						orgId,
						right: 'master',
						recordingId: neonSun,
						holderLabelId: labelId,
						territory: 'WW',
						share: '50'
					})
				)
			);
			expect(msg).toContain('total 50%, not 100%');
		});

		it('only owners and rights admins can see or change ownership', async () => {
			const msg = await failure(
				as(catalogManager, (tx) =>
					setOwnership(tx, ctx(catalogManager), {
						right: 'master',
						targetId: neonSun,
						territory: 'WW',
						holders: [{ labelId, share: '100' }]
					})
				)
			);
			expect(msg).toMatch(/row-level security/);
		});

		it('claims a label’s masters in bulk, skipping ones already set', async () => {
			// One recording gets a split first; the claim must leave it alone.
			await as(rightsAdmin, (tx) =>
				setOwnership(tx, ctx(rightsAdmin), {
					right: 'master',
					targetId: neonSun,
					territory: 'WW',
					holders: [
						{ labelId, share: '50' },
						{ partyId: vexo, share: '50' }
					]
				})
			);
			const before = await as(rightsAdmin, (tx) => masterCoverage(tx, orgId));
			expect(before.complete).toBe(1);

			const res = await as(owner, (tx) => claimMastersForLabel(tx, ctx(owner), labelId));
			expect(res.count).toBeGreaterThan(0);

			const after = await as(rightsAdmin, (tx) => masterCoverage(tx, orgId));
			expect(after.complete).toBe(before.complete + res.count);
			expect(after.missing.length).toBe(after.total - after.complete);

			const again = await as(owner, (tx) => claimMastersForLabel(tx, ctx(owner), labelId));
			expect(again.count).toBe(0);

			const split = await db
				.select()
				.from(rightsShares)
				.where(eq(rightsShares.recordingId, neonSun));
			expect(split.map((s) => Number(s.share)).sort()).toEqual([50, 50]);
		});

		it('hides shares from viewers and catalog managers', async () => {
			for (const user of [viewer, catalogManager]) {
				const rows = await as(user, (tx) => tx.select().from(rightsShares));
				expect(rows).toEqual([]);
			}
			expect(
				(await as(rightsAdmin, (tx) => tx.select().from(rightsShares))).length
			).toBeGreaterThan(0);
		});
	});

	describe('authorize()', () => {
		it('allows analysis once ownership is complete and the label holds a share', async () => {
			const d = await as(catalogManager, (tx) => authorize(tx, orgId, neonSun, 'analysis'));
			expect(d).toMatchObject({ allowed: true, reasons: [] });
			expect(d.basis).toMatchObject({ master_complete: true, label_share: 50 });
		});

		it('stems need 100% label ownership or a consent', async () => {
			const before = await as(catalogManager, (tx) =>
				authorize(tx, orgId, neonSun, 'stem_separation')
			);
			expect(before.reasons).toEqual(['consent_missing']);

			const consent = await as(rightsAdmin, (tx) =>
				grantConsent(tx, ctx(rightsAdmin), {
					partyId: vexo,
					purpose: 'stem_separation',
					grantedOn: '2026-01-01'
				})
			);
			const after = await as(catalogManager, (tx) =>
				authorize(tx, orgId, neonSun, 'stem_separation')
			);
			expect(after.allowed).toBe(true);
			expect(after.basis).toMatchObject({ consents: [consent.id] });
		});

		it('voice needs consent from every main artist, and revoking takes it away', async () => {
			const none = await as(owner, (tx) => authorize(tx, orgId, neonSun, 'voice'));
			expect(none.reasons).toEqual(['consent_missing']);
			expect(none.basis).toMatchObject({ missing_consent: [vexo] });

			// Consent from someone not credited on the recording doesn't count.
			await as(rightsAdmin, (tx) =>
				grantConsent(tx, ctx(rightsAdmin), {
					partyId: emy,
					purpose: 'voice',
					grantedOn: '2026-01-01'
				})
			);
			expect((await as(owner, (tx) => authorize(tx, orgId, neonSun, 'voice'))).allowed).toBe(false);

			const c = await as(rightsAdmin, (tx) =>
				grantConsent(tx, ctx(rightsAdmin), {
					partyId: vexo,
					purpose: 'voice',
					recordingId: neonSun,
					grantedOn: '2026-01-01'
				})
			);
			expect((await as(owner, (tx) => authorize(tx, orgId, neonSun, 'voice'))).allowed).toBe(true);

			await as(rightsAdmin, (tx) => revokeConsent(tx, ctx(rightsAdmin), c.id));
			expect((await as(owner, (tx) => authorize(tx, orgId, neonSun, 'voice'))).allowed).toBe(false);
		});

		it('expired and future consents do not count', async () => {
			const [{ id: rec }] = await db
				.select({ id: recordings.id })
				.from(recordings)
				.where(eq(recordings.isrc, 'ZZAA12510453'));
			await as(rightsAdmin, (tx) =>
				grantConsent(tx, ctx(rightsAdmin), {
					partyId: vexo,
					purpose: 'generation',
					recordingId: rec,
					grantedOn: '2020-01-01',
					expiresOn: '2020-12-31'
				})
			);
			await as(rightsAdmin, (tx) =>
				grantConsent(tx, ctx(rightsAdmin), {
					partyId: vexo,
					purpose: 'generation',
					recordingId: rec,
					grantedOn: '2999-01-01'
				})
			);
			expect((await as(owner, (tx) => authorize(tx, orgId, rec, 'generation'))).allowed).toBe(
				false
			);
		});

		it('records every decision with who asked; only processing roles may ask', async () => {
			const d = await as(agent, (tx) => authorize(tx, orgId, neonSun, 'analysis'));
			const [row] = await db
				.select()
				.from(authorizationDecisions)
				.where(eq(authorizationDecisions.id, d.id));
			expect(row).toMatchObject({ actorId: agent, actorKind: 'agent', allowed: true });

			for (const user of [viewer, rightsAdmin]) {
				expect(
					await failure(as(user, (tx) => authorize(tx, orgId, neonSun, 'analysis')))
				).toContain('not allowed to request processing');
			}
			// Nobody can write a decision directly.
			const forged = await failure(
				as(owner, (tx) =>
					tx.insert(authorizationDecisions).values({
						orgId,
						recordingId: neonSun,
						purpose: 'voice',
						allowed: true,
						reasons: [],
						basis: {},
						actorId: owner,
						actorKind: 'user'
					})
				)
			);
			expect(forged).toMatch(/permission denied/);
		});
	});

	describe('compositions and agreements', () => {
		it('creates a composition linked to recordings, with writer splits that total 100', async () => {
			const comp = await as(rightsAdmin, (tx) =>
				createComposition(tx, ctx(rightsAdmin), {
					title: 'Argon Dawn',
					iswc: 'T-034.524.680-1',
					recordingIds: [neonSun]
				})
			);
			expect(comp.iswc).toBe('T0345246801');

			await expect(
				as(rightsAdmin, (tx) =>
					setWriters(tx, ctx(rightsAdmin), {
						compositionId: comp.id,
						writers: [{ partyId: vexo, role: 'composer', share: '90' }]
					})
				)
			).rejects.toBeInstanceOf(EditError);

			await as(rightsAdmin, (tx) =>
				setWriters(tx, ctx(rightsAdmin), {
					compositionId: comp.id,
					writers: [
						{ partyId: vexo, role: 'composer', share: '66.6667' },
						{ partyId: emy, role: 'lyricist', share: '33.3333' }
					]
				})
			);
			const rows = await db
				.select()
				.from(compositionWriters)
				.where(eq(compositionWriters.compositionId, comp.id));
			expect(rows).toHaveLength(2);

			// Everyone in the label can read writers; only rights roles can change them.
			expect(
				(await as(viewer, (tx) => tx.select().from(compositionWriters))).length
			).toBeGreaterThan(0);
			await expect(
				as(viewer, (tx) => createComposition(tx, ctx(viewer), { title: 'Nope' }))
			).rejects.toThrow();

			await expect(
				as(rightsAdmin, (tx) =>
					createComposition(tx, ctx(rightsAdmin), { title: 'Dup', iswc: 'T0345246801' })
				)
			).rejects.toBeInstanceOf(EditError);
			await expect(
				as(rightsAdmin, (tx) =>
					createComposition(tx, ctx(rightsAdmin), { title: 'Bad', iswc: 'T0345246802' })
				)
			).rejects.toBeInstanceOf(EditError);
		});

		it('publishing shares follow the same 100% rule', async () => {
			const comp = await as(rightsAdmin, (tx) =>
				createComposition(tx, ctx(rightsAdmin), { title: 'Work' })
			);
			await as(rightsAdmin, (tx) =>
				setOwnership(tx, ctx(rightsAdmin), {
					right: 'publishing',
					targetId: comp.id,
					territory: 'nl',
					holders: [{ partyId: vexo, share: '100' }]
				})
			);
			const rows = await db
				.select()
				.from(rightsShares)
				.where(eq(rightsShares.compositionId, comp.id));
			expect(rows).toMatchObject([{ right: 'publishing', territory: 'NL' }]);
		});

		it('creates agreements and checks their dates', async () => {
			const a = await as(rightsAdmin, (tx) =>
				createAgreement(tx, ctx(rightsAdmin), {
					labelId,
					counterpartyId: vexo,
					kind: 'recording',
					title: 'Vexo Rand — THE PLATEAU',
					status: 'active',
					signedOn: '2025-05-01',
					startsOn: '2025-05-01',
					endsOn: '2030-05-01'
				})
			);
			expect(a.territory).toBe('WW');
			await expect(
				as(rightsAdmin, (tx) =>
					createAgreement(tx, ctx(rightsAdmin), {
						labelId,
						counterpartyId: vexo,
						kind: 'recording',
						title: 'Backwards',
						startsOn: '2025-05-01',
						endsOn: '2024-05-01'
					})
				)
			).rejects.toBeInstanceOf(EditError);
			// Viewers can't see agreements at all.
			expect(await as(viewer, (tx) => tx.query.agreements.findMany())).toEqual([]);
		});
	});

	describe('composition screens', () => {
		it('edits a composition with stale-write protection and ISWC checks', async () => {
			const comp = await as(rightsAdmin, (tx) =>
				createComposition(tx, ctx(rightsAdmin), { title: 'Fizz Snap' })
			);
			const stamp = comp.updatedAt.toISOString();
			await as(rightsAdmin, (tx) =>
				updateComposition(
					tx,
					ctx(rightsAdmin),
					comp.id,
					{ title: 'FIZZ SNAP', iswc: 'T-034.524.680-1' },
					stamp
				)
			).then(
				() => {
					throw new Error('expected the ISWC clash to be refused');
				},
				(e) => expect(e).toBeInstanceOf(EditError)
			);
			await as(rightsAdmin, (tx) =>
				updateComposition(tx, ctx(rightsAdmin), comp.id, { title: 'FIZZ SNAP', iswc: '' }, stamp)
			);
			// The old timestamp is now stale.
			await expect(
				as(rightsAdmin, (tx) =>
					updateComposition(tx, ctx(rightsAdmin), comp.id, { title: 'Again', iswc: '' }, stamp)
				)
			).rejects.toBeInstanceOf(EditError);
		});

		it('links and unlinks recordings', async () => {
			const comp = await as(rightsAdmin, (tx) =>
				createComposition(tx, ctx(rightsAdmin), { title: 'Linkable' })
			);
			await as(rightsAdmin, (tx) => setRecordingLink(tx, ctx(rightsAdmin), comp.id, neonSun, true));
			let got = await as(viewer, (tx) => getComposition(tx, orgId, comp.id));
			expect(got?.recordings.map((r) => r.id)).toEqual([neonSun]);
			// Linking twice changes nothing.
			const again = await as(rightsAdmin, (tx) =>
				setRecordingLink(tx, ctx(rightsAdmin), comp.id, neonSun, true)
			);
			expect(again.changed).toBe(false);
			await as(rightsAdmin, (tx) =>
				setRecordingLink(tx, ctx(rightsAdmin), comp.id, neonSun, false)
			);
			got = await as(viewer, (tx) => getComposition(tx, orgId, comp.id));
			expect(got?.recordings).toEqual([]);
		});

		it('lists compositions with writers, and reads publishing by territory', async () => {
			const list = await as(viewer, (tx) => listCompositions(tx, orgId));
			const neon = list.find((c) => c.title === 'Argon Dawn');
			expect(neon).toMatchObject({
				iswc: 'T0345246801',
				recordings: 1,
				writers: 'Vexo Rand, Ema Stone'
			});

			const work = list.find((c) => c.title === 'Work')!;
			const pub = await as(rightsAdmin, (tx) => ownershipFor(tx, orgId, 'publishing', work.id));
			expect(pub).toMatchObject([
				{ territory: 'NL', holders: [{ name: 'Vexo Rand', share: '100' }] }
			]);
			// Viewers see the composition but not who publishes it.
			expect(await as(viewer, (tx) => ownershipFor(tx, orgId, 'publishing', work.id))).toEqual([]);
		});

		it('reads writer rows from the form', () => {
			expect(
				writersFromForm({
					writer_0: 'a',
					role_0: 'composer',
					share_0: '50',
					writer_1: '',
					share_1: '',
					writer_2: 'b',
					share_2: '50'
				})
			).toEqual([
				{ partyId: 'a', role: 'composer', share: '50' },
				{ partyId: 'b', role: 'composer_lyricist', share: '50' }
			]);
		});
	});
});
