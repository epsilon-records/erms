import { and, asc, eq, inArray, isNull, notExists, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type Database, NoChange, withAudit } from './audit';
import { EditError, type EditCtx } from './catalog-edit';
import {
	agreementKindEnum,
	agreements,
	compositions,
	compositionWriters,
	consents,
	labels,
	parties,
	processingPurposeEnum,
	recordingCompositions,
	recordings,
	releases,
	releaseTracks,
	rightsShares,
	writerRoleEnum,
	type AuthorizationDecision,
	type ProcessingPurpose
} from './db/schema';

/**
 * Phase 2: rights and contracts.
 *
 * Shares are percentages with up to four decimals, handled as strings and compared in
 * ten-thousandths so 33.3333 + 33.3333 + 33.3334 is exactly 100. The database checks
 * the same rule at commit (migration 0010); this module checks first so the user gets
 * a field-level message instead of a constraint error.
 */

const SCALE = 10_000;
const TERRITORY = /^(WW|[A-Z]{2})$/;

/** "33.3333" -> 333333. Null for anything that isn't a share between 0 and 100. */
export function parseShare(raw: string): number | null {
	const s = raw.trim();
	if (!/^\d{1,3}(\.\d{1,4})?$/.test(s)) return null;
	const [whole, frac = ''] = s.split('.');
	const units = Number(whole) * SCALE + Number(frac.padEnd(4, '0'));
	return units > 0 && units <= 100 * SCALE ? units : null;
}

const formatShare = (units: number) => String(units / SCALE);

function fieldsFrom(error: z.ZodError): Record<string, string> {
	return Object.fromEntries(error.issues.map((i) => [i.path.join('.') || 'form', i.message]));
}

const shareString = z.union([z.string(), z.number()]).transform((v, ctx) => {
	const units = parseShare(String(v));
	if (units == null) {
		ctx.addIssue({ code: 'custom', message: 'Share must be more than 0 and at most 100' });
		return z.NEVER;
	}
	return units;
});

const optionalDate = z
	.string()
	.trim()
	.transform((s) => (s === '' ? null : s))
	.refine((d) => d == null || /^\d{4}-\d{2}-\d{2}$/.test(d), { message: 'Use YYYY-MM-DD' });

function assertHundred(units: number[], label: string) {
	const total = units.reduce((a, b) => a + b, 0);
	if (units.length && total !== 100 * SCALE) {
		throw new EditError({ shares: `${label} total ${formatShare(total)}%, not 100%` });
	}
}

/* ------------------------------------------------------------------------- */
/* Ownership                                                                  */
/* ------------------------------------------------------------------------- */

const Holder = z.union([
	z.object({ labelId: z.uuid(), share: shareString, agreementId: z.uuid().nullish() }),
	z.object({ partyId: z.uuid(), share: shareString, agreementId: z.uuid().nullish() })
]);

export const OwnershipInput = z.object({
	right: z.enum(['master', 'publishing']),
	/** A recording for master, a composition for publishing. */
	targetId: z.uuid(),
	territory: z
		.string()
		.trim()
		.toUpperCase()
		.refine((t) => TERRITORY.test(t), {
			message: "Territory is 'WW' or a two-letter country code"
		}),
	/** The complete new set. Empty removes ownership for this territory. */
	holders: z.array(Holder).max(50)
});

/** Replace every share for one target, right and territory with a new set. */
export async function setOwnership(db: Database, ctx: EditCtx, input: unknown) {
	const parsed = OwnershipInput.safeParse(input);
	if (!parsed.success) throw new EditError(fieldsFrom(parsed.error));
	const { right, targetId, territory, holders } = parsed.data;
	assertHundred(
		holders.map((h) => h.share),
		'Shares'
	);
	const holderKey = (h: (typeof holders)[number]) =>
		'labelId' in h ? `l:${h.labelId}` : `p:${h.partyId}`;
	if (new Set(holders.map(holderKey)).size !== holders.length) {
		throw new EditError({ shares: 'Each holder can appear only once' });
	}

	const targetCol = right === 'master' ? rightsShares.recordingId : rightsShares.compositionId;
	return withAudit(db, ctx, async (tx, audit) => {
		const table = right === 'master' ? recordings : compositions;
		const [target] = await tx
			.select({ id: table.id })
			.from(table)
			.where(and(eq(table.orgId, ctx.orgId), eq(table.id, targetId)));
		if (!target)
			throw new EditError({
				form: `${right === 'master' ? 'Recording' : 'Composition'} not found`
			});

		const group = and(
			eq(rightsShares.orgId, ctx.orgId),
			eq(rightsShares.right, right),
			eq(targetCol, targetId),
			eq(rightsShares.territory, territory)
		);
		const before = await tx
			.select({
				holderLabelId: rightsShares.holderLabelId,
				holderPartyId: rightsShares.holderPartyId,
				share: rightsShares.share,
				agreementId: rightsShares.agreementId
			})
			.from(rightsShares)
			.where(group)
			.orderBy(asc(rightsShares.createdAt));
		const after = holders.map((h) => ({
			holderLabelId: 'labelId' in h ? h.labelId : null,
			holderPartyId: 'partyId' in h ? h.partyId : null,
			share: formatShare(h.share),
			agreementId: h.agreementId ?? null
		}));
		const norm = (rows: typeof after) =>
			JSON.stringify(
				rows
					.map((r) => ({ ...r, share: String(Number(r.share)) }))
					.sort((a, b) =>
						`${a.holderLabelId}${a.holderPartyId}`.localeCompare(
							`${b.holderLabelId}${b.holderPartyId}`
						)
					)
			);
		if (norm(before) === norm(after)) throw new NoChange({ changed: false as const });

		await tx.delete(rightsShares).where(group);
		if (after.length) {
			await tx.insert(rightsShares).values(
				after.map((a) => ({
					orgId: ctx.orgId,
					right,
					recordingId: right === 'master' ? targetId : null,
					compositionId: right === 'publishing' ? targetId : null,
					territory,
					...a
				}))
			);
		}
		await audit({
			entity: right === 'master' ? 'recording' : 'composition',
			entityId: targetId,
			action: `${right}_ownership`,
			before: { territory, holders: before },
			after: { territory, holders: after }
		});
		return { changed: true as const };
	});
}

/**
 * Give one of the org's labels 100% worldwide master ownership of every recording on
 * that label's releases that has no worldwide master ownership yet. Recordings that
 * already have it are left alone. Returns how many were set.
 */
export async function claimMastersForLabel(db: Database, ctx: EditCtx, labelId: string) {
	if (!z.uuid().safeParse(labelId).success) throw new EditError({ labelId: 'Choose a label' });
	return withAudit(db, ctx, async (tx, audit) => {
		const [label] = await tx
			.select({ id: labels.id, name: labels.name })
			.from(labels)
			.where(and(eq(labels.orgId, ctx.orgId), eq(labels.id, labelId)));
		if (!label) throw new EditError({ labelId: 'Unknown label' });

		const open = await tx
			.selectDistinct({ id: recordings.id })
			.from(recordings)
			.innerJoin(releaseTracks, eq(releaseTracks.recordingId, recordings.id))
			.innerJoin(releases, eq(releases.id, releaseTracks.releaseId))
			.where(
				and(
					eq(recordings.orgId, ctx.orgId),
					eq(releases.labelId, labelId),
					notExists(
						tx
							.select({ one: sql`1` })
							.from(rightsShares)
							.where(
								and(
									eq(rightsShares.recordingId, recordings.id),
									eq(rightsShares.right, 'master'),
									eq(rightsShares.territory, 'WW')
								)
							)
					)
				)
			);
		if (!open.length) throw new NoChange({ changed: false as const, count: 0 });

		await tx.insert(rightsShares).values(
			open.map((r) => ({
				orgId: ctx.orgId,
				right: 'master' as const,
				recordingId: r.id,
				holderLabelId: labelId,
				territory: 'WW',
				share: '100'
			}))
		);
		await audit(
			open.map((r) => ({
				entity: 'recording',
				entityId: r.id,
				action: 'master_ownership',
				before: { territory: 'WW', holders: [] },
				after: {
					territory: 'WW',
					holders: [
						{ holderLabelId: labelId, holderPartyId: null, share: '100', agreementId: null }
					],
					via: `claim for ${label.name}`
				}
			}))
		);
		return { changed: true as const, count: open.length };
	});
}

/** The Phase 2 gate: recordings that still lack worldwide master ownership. */
export async function masterCoverage(db: Database, orgId: string) {
	const missing = await db
		.select({
			id: recordings.id,
			title: recordings.title,
			versionTitle: recordings.versionTitle,
			isrc: recordings.isrc
		})
		.from(recordings)
		.where(
			and(
				eq(recordings.orgId, orgId),
				notExists(
					db
						.select({ one: sql`1` })
						.from(rightsShares)
						.where(
							and(
								eq(rightsShares.recordingId, recordings.id),
								eq(rightsShares.right, 'master'),
								eq(rightsShares.territory, 'WW')
							)
						)
				)
			)
		)
		.orderBy(asc(recordings.title));
	const [{ total }] = await db
		.select({ total: sql<number>`count(*)::int` })
		.from(recordings)
		.where(eq(recordings.orgId, orgId));
	return { total, complete: total - missing.length, missing };
}

/* ------------------------------------------------------------------------- */
/* Compositions and writers                                                   */
/* ------------------------------------------------------------------------- */

/** ISWC as stored: T plus ten digits, separators removed. Null when blank. */
export function normalizeIswc(raw: string): string | null {
	const s = raw.replace(/[\s.\-]/g, '').toUpperCase();
	return s === '' ? null : s;
}

/** ISWC check digit: weighted sum of the nine work digits, mod 10. */
export function isValidIswc(iswc: string): boolean {
	if (!/^T\d{10}$/.test(iswc)) return false;
	const d = iswc.slice(1).split('').map(Number);
	let sum = 1;
	for (let i = 0; i < 9; i++) sum += d[i] * (i + 1);
	return (10 - (sum % 10)) % 10 === d[9];
}

export const CompositionInput = z.object({
	title: z.string().trim().min(1, 'Title is required'),
	iswc: z
		.string()
		.default('')
		.transform(normalizeIswc)
		.refine((v) => v == null || isValidIswc(v), { message: 'ISWC must look like T-123.456.789-0' }),
	/** Recordings of this work. */
	recordingIds: z.array(z.uuid()).max(200).default([])
});

export async function createComposition(db: Database, ctx: EditCtx, input: unknown) {
	const parsed = CompositionInput.safeParse(input);
	if (!parsed.success) throw new EditError(fieldsFrom(parsed.error));
	const { title, iswc, recordingIds } = parsed.data;
	return withAudit(db, ctx, async (tx, audit) => {
		if (iswc) {
			const [clash] = await tx
				.select({ title: compositions.title })
				.from(compositions)
				.where(and(eq(compositions.orgId, ctx.orgId), eq(compositions.iswc, iswc)));
			if (clash) throw new EditError({ iswc: `ISWC already used by "${clash.title}"` });
		}
		if (recordingIds.length) {
			const found = await tx
				.select({ id: recordings.id })
				.from(recordings)
				.where(and(eq(recordings.orgId, ctx.orgId), inArray(recordings.id, recordingIds)));
			if (found.length !== new Set(recordingIds).size) {
				throw new EditError({ recordingIds: 'Unknown recording' });
			}
		}
		const [created] = await tx
			.insert(compositions)
			.values({ orgId: ctx.orgId, title, iswc })
			.returning();
		const links = [...new Set(recordingIds)];
		if (links.length) {
			await tx
				.insert(recordingCompositions)
				.values(
					links.map((recordingId) => ({ orgId: ctx.orgId, recordingId, compositionId: created.id }))
				);
		}
		await audit({
			entity: 'composition',
			entityId: created.id,
			action: 'create',
			after: { title, iswc, recordingIds: links }
		});
		return created;
	});
}

export const WritersInput = z.object({
	compositionId: z.uuid(),
	writers: z
		.array(
			z.object({
				partyId: z.uuid(),
				role: z.enum(writerRoleEnum.enumValues),
				share: shareString
			})
		)
		.max(50)
});

/** Replace a composition's writer splits. Empty removes them. */
export async function setWriters(db: Database, ctx: EditCtx, input: unknown) {
	const parsed = WritersInput.safeParse(input);
	if (!parsed.success) throw new EditError(fieldsFrom(parsed.error));
	const { compositionId, writers } = parsed.data;
	assertHundred(
		writers.map((w) => w.share),
		'Writer splits'
	);
	if (new Set(writers.map((w) => `${w.partyId}:${w.role}`)).size !== writers.length) {
		throw new EditError({ shares: 'Each writer can have each role only once' });
	}
	return withAudit(db, ctx, async (tx, audit) => {
		const [comp] = await tx
			.select({ id: compositions.id })
			.from(compositions)
			.where(and(eq(compositions.orgId, ctx.orgId), eq(compositions.id, compositionId)));
		if (!comp) throw new EditError({ form: 'Composition not found' });
		if (writers.length) {
			const ids = [...new Set(writers.map((w) => w.partyId))];
			const found = await tx
				.select({ id: parties.id })
				.from(parties)
				.where(and(eq(parties.orgId, ctx.orgId), inArray(parties.id, ids)));
			if (found.length !== ids.length) throw new EditError({ writers: 'Unknown writer' });
		}
		const before = await tx
			.select({
				partyId: compositionWriters.partyId,
				role: compositionWriters.role,
				share: compositionWriters.share
			})
			.from(compositionWriters)
			.where(eq(compositionWriters.compositionId, compositionId));
		const after = writers.map((w) => ({
			partyId: w.partyId,
			role: w.role,
			share: formatShare(w.share)
		}));
		await tx.delete(compositionWriters).where(eq(compositionWriters.compositionId, compositionId));
		if (after.length) {
			await tx
				.insert(compositionWriters)
				.values(after.map((w) => ({ orgId: ctx.orgId, compositionId, ...w })));
		}
		await audit({
			entity: 'composition',
			entityId: compositionId,
			action: 'writers',
			before,
			after
		});
		return { changed: true as const };
	});
}

/* ------------------------------------------------------------------------- */
/* Agreements and consents                                                    */
/* ------------------------------------------------------------------------- */

export const AgreementInput = z.object({
	labelId: z.uuid('Choose a label'),
	counterpartyId: z.uuid('Choose a counterparty'),
	kind: z.enum(agreementKindEnum.enumValues),
	title: z.string().trim().min(1, 'Title is required'),
	status: z.enum(['draft', 'active', 'expired', 'terminated']).default('draft'),
	signedOn: optionalDate.prefault(''),
	startsOn: optionalDate.prefault(''),
	endsOn: optionalDate.prefault(''),
	territory: z
		.string()
		.trim()
		.toUpperCase()
		.default('WW')
		.refine((t) => TERRITORY.test(t), {
			message: "Territory is 'WW' or a two-letter country code"
		}),
	notes: z
		.string()
		.trim()
		.default('')
		.transform((s) => (s === '' ? null : s))
});

export async function createAgreement(db: Database, ctx: EditCtx, input: unknown) {
	const parsed = AgreementInput.safeParse(input);
	if (!parsed.success) throw new EditError(fieldsFrom(parsed.error));
	const a = parsed.data;
	if (a.startsOn && a.endsOn && a.endsOn < a.startsOn) {
		throw new EditError({ endsOn: 'The end date is before the start date' });
	}
	return withAudit(db, ctx, async (tx, audit) => {
		const [label] = await tx
			.select({ id: labels.id })
			.from(labels)
			.where(and(eq(labels.orgId, ctx.orgId), eq(labels.id, a.labelId)));
		if (!label) throw new EditError({ labelId: 'Unknown label' });
		const [party] = await tx
			.select({ id: parties.id })
			.from(parties)
			.where(and(eq(parties.orgId, ctx.orgId), eq(parties.id, a.counterpartyId)));
		if (!party) throw new EditError({ counterpartyId: 'Unknown counterparty' });
		const [created] = await tx
			.insert(agreements)
			.values({ orgId: ctx.orgId, ...a })
			.returning();
		await audit({ entity: 'agreement', entityId: created.id, action: 'create', after: a });
		return created;
	});
}

export const ConsentInput = z.object({
	partyId: z.uuid('Choose who gives consent'),
	purpose: z.enum(processingPurposeEnum.enumValues),
	/** One recording, or blank for every recording that credits this party. */
	recordingId: z
		.string()
		.default('')
		.transform((s) => (s === '' ? null : s))
		.pipe(z.uuid().nullable()),
	agreementId: z
		.string()
		.default('')
		.transform((s) => (s === '' ? null : s))
		.pipe(z.uuid().nullable()),
	grantedOn: z
		.string()
		.trim()
		.refine((d) => /^\d{4}-\d{2}-\d{2}$/.test(d), { message: 'Use YYYY-MM-DD' }),
	expiresOn: optionalDate.prefault(''),
	notes: z
		.string()
		.trim()
		.default('')
		.transform((s) => (s === '' ? null : s))
});

export async function grantConsent(db: Database, ctx: EditCtx, input: unknown) {
	const parsed = ConsentInput.safeParse(input);
	if (!parsed.success) throw new EditError(fieldsFrom(parsed.error));
	const c = parsed.data;
	if (c.expiresOn && c.expiresOn < c.grantedOn) {
		throw new EditError({ expiresOn: 'Expiry is before the grant date' });
	}
	return withAudit(db, ctx, async (tx, audit) => {
		const [party] = await tx
			.select({ id: parties.id })
			.from(parties)
			.where(and(eq(parties.orgId, ctx.orgId), eq(parties.id, c.partyId)));
		if (!party) throw new EditError({ partyId: 'Unknown party' });
		if (c.recordingId) {
			const [rec] = await tx
				.select({ id: recordings.id })
				.from(recordings)
				.where(and(eq(recordings.orgId, ctx.orgId), eq(recordings.id, c.recordingId)));
			if (!rec) throw new EditError({ recordingId: 'Unknown recording' });
		}
		const [created] = await tx
			.insert(consents)
			.values({ orgId: ctx.orgId, ...c })
			.returning();
		await audit({ entity: 'consent', entityId: created.id, action: 'grant', after: c });
		return created;
	});
}

/** Revoking keeps the record: past decisions stay explainable. */
export async function revokeConsent(db: Database, ctx: EditCtx, consentId: string) {
	return withAudit(db, ctx, async (tx, audit) => {
		const [cur] = await tx
			.select()
			.from(consents)
			.where(and(eq(consents.orgId, ctx.orgId), eq(consents.id, consentId)))
			.for('update');
		if (!cur) throw new EditError({ form: 'Consent not found' });
		if (cur.revokedAt) throw new NoChange({ changed: false as const });
		const revokedAt = new Date();
		await tx
			.update(consents)
			.set({ revokedAt })
			.where(and(eq(consents.id, consentId), isNull(consents.revokedAt)));
		await audit({ entity: 'consent', entityId: consentId, action: 'revoke', after: { revokedAt } });
		return { changed: true as const };
	});
}

/* ------------------------------------------------------------------------- */
/* authorize()                                                                */
/* ------------------------------------------------------------------------- */

export type Decision = Pick<
	AuthorizationDecision,
	'id' | 'allowed' | 'reasons' | 'basis' | 'purpose' | 'recordingId'
>;

/**
 * May this recording be processed for this purpose? The database decides and records
 * the decision in one call (app.authorize, migration 0010); pass the returned id to
 * AudioKit as authorization.decision_id.
 */
export async function authorize(
	db: Database,
	orgId: string,
	recordingId: string,
	purpose: ProcessingPurpose
): Promise<Decision> {
	const result = (await db.execute(
		sql`select id, allowed, reasons, basis, purpose, recording_id as "recordingId"
			from app.authorize(${orgId}::uuid, ${recordingId}::uuid, ${purpose}::processing_purpose)`
	)) as unknown as { rows?: Decision[] } | Decision[];
	const rows = Array.isArray(result) ? result : (result.rows ?? []);
	return rows[0];
}

/* ------------------------------------------------------------------------- */
/* Read side for the rights screens                                           */
/* ------------------------------------------------------------------------- */

/** Everyone who can hold a share: the org's labels first, then parties. */
export async function holderOptions(db: Database, orgId: string) {
	const [ls, ps] = await Promise.all([
		db
			.select({ id: labels.id, name: labels.name })
			.from(labels)
			.where(eq(labels.orgId, orgId))
			.orderBy(asc(labels.name)),
		db
			.select({ id: parties.id, name: parties.displayName })
			.from(parties)
			.where(eq(parties.orgId, orgId))
			.orderBy(asc(sql`lower(${parties.displayName})`))
	]);
	return { labels: ls, parties: ps };
}

/** Shares for one target and right, grouped by territory, worldwide first. */
export async function ownershipFor(
	db: Database,
	orgId: string,
	right: 'master' | 'publishing',
	targetId: string
) {
	const targetCol = right === 'master' ? rightsShares.recordingId : rightsShares.compositionId;
	const rows = await db
		.select({
			territory: rightsShares.territory,
			share: rightsShares.share,
			labelId: rightsShares.holderLabelId,
			partyId: rightsShares.holderPartyId,
			labelName: labels.name,
			partyName: parties.displayName
		})
		.from(rightsShares)
		.leftJoin(labels, eq(labels.id, rightsShares.holderLabelId))
		.leftJoin(parties, eq(parties.id, rightsShares.holderPartyId))
		.where(
			and(eq(rightsShares.orgId, orgId), eq(targetCol, targetId), eq(rightsShares.right, right))
		)
		.orderBy(asc(rightsShares.territory), asc(rightsShares.createdAt));
	const groups = new Map<
		string,
		{ holder: string; name: string; isLabel: boolean; share: string }[]
	>();
	for (const r of rows) {
		const list = groups.get(r.territory) ?? [];
		list.push({
			holder: r.labelId ? `l:${r.labelId}` : `p:${r.partyId}`,
			name: (r.labelName ?? r.partyName)!,
			isLabel: !!r.labelId,
			share: String(Number(r.share))
		});
		groups.set(r.territory, list);
	}
	return [...groups.entries()]
		.sort(([a], [b]) => (a === 'WW' ? -1 : b === 'WW' ? 1 : a.localeCompare(b)))
		.map(([territory, holders]) => ({ territory, holders }));
}

export const recordingOwnership = (db: Database, orgId: string, recordingId: string) =>
	ownershipFor(db, orgId, 'master', recordingId);

/** Per label: recordings on its releases still without worldwide master ownership. */
export async function openMastersByLabel(db: Database, orgId: string) {
	return db
		.select({
			id: labels.id,
			name: labels.name,
			open: sql<number>`count(distinct ${recordings.id}) filter (where not exists (
				select 1 from ${rightsShares}
				where ${rightsShares.recordingId} = ${recordings.id}
					and ${rightsShares.right} = 'master' and ${rightsShares.territory} = 'WW'))::int`
		})
		.from(labels)
		.leftJoin(releases, eq(releases.labelId, labels.id))
		.leftJoin(releaseTracks, eq(releaseTracks.releaseId, releases.id))
		.leftJoin(recordings, eq(recordings.id, releaseTracks.recordingId))
		.where(eq(labels.orgId, orgId))
		.groupBy(labels.id)
		.orderBy(asc(labels.name));
}

export async function listAgreements(db: Database, orgId: string) {
	return db
		.select({
			id: agreements.id,
			title: agreements.title,
			kind: agreements.kind,
			status: agreements.status,
			signedOn: agreements.signedOn,
			startsOn: agreements.startsOn,
			endsOn: agreements.endsOn,
			territory: agreements.territory,
			label: labels.name,
			counterparty: parties.displayName,
			counterpartyId: parties.id
		})
		.from(agreements)
		.innerJoin(labels, eq(labels.id, agreements.labelId))
		.innerJoin(parties, eq(parties.id, agreements.counterpartyId))
		.where(eq(agreements.orgId, orgId))
		.orderBy(sql`${agreements.signedOn} desc nulls last`, asc(agreements.title));
}

export async function listConsents(db: Database, orgId: string) {
	return db
		.select({
			id: consents.id,
			purpose: consents.purpose,
			grantedOn: consents.grantedOn,
			expiresOn: consents.expiresOn,
			revokedAt: consents.revokedAt,
			notes: consents.notes,
			party: parties.displayName,
			partyId: parties.id,
			recordingId: consents.recordingId,
			recording: recordings.title,
			recordingVersion: recordings.versionTitle,
			agreement: agreements.title
		})
		.from(consents)
		.innerJoin(parties, eq(parties.id, consents.partyId))
		.leftJoin(recordings, eq(recordings.id, consents.recordingId))
		.leftJoin(agreements, eq(agreements.id, consents.agreementId))
		.where(eq(consents.orgId, orgId))
		.orderBy(sql`${consents.revokedAt} is not null`, sql`${consents.grantedOn} desc`);
}

/** Turn the ownership editor's rows (holder_0, share_0, ...) into setOwnership input. */
export function holdersFromForm(fields: Record<string, string>) {
	const holders: Record<string, string>[] = [];
	for (let i = 0; i < 20; i++) {
		const holder = fields[`holder_${i}`]?.trim();
		const share = fields[`share_${i}`]?.trim();
		if (!holder && !share) continue;
		const [kind, id] = (holder ?? '').split(':');
		holders.push(
			kind === 'l'
				? { labelId: id ?? '', share: share ?? '' }
				: { partyId: id ?? '', share: share ?? '' }
		);
	}
	return holders;
}

/* ------------------------------------------------------------------------- */
/* Compositions: read side and edits                                          */
/* ------------------------------------------------------------------------- */

export async function listCompositions(db: Database, orgId: string) {
	const rows = await db
		.select({
			id: compositions.id,
			title: compositions.title,
			iswc: compositions.iswc,
			// Fully qualified: Drizzle omits the table name in single-table selects, which
			// would make "id" ambiguous inside these subqueries.
			recordings: sql<number>`(select count(*)::int from recording_compositions rc
				where rc.composition_id = "compositions"."id")`,
			writers: sql<
				string | null
			>`(select string_agg(p.display_name, ', ' order by w.share desc, p.display_name)
				from composition_writers w join parties p on p.id = w.party_id
				where w.composition_id = "compositions"."id")`
		})
		.from(compositions)
		.where(eq(compositions.orgId, orgId))
		.orderBy(asc(sql`lower(${compositions.title})`));
	return rows;
}

export async function getComposition(db: Database, orgId: string, id: string) {
	const [composition] = await db
		.select()
		.from(compositions)
		.where(and(eq(compositions.orgId, orgId), eq(compositions.id, id)));
	if (!composition) return null;
	const [recs, writers] = await Promise.all([
		db
			.select({
				id: recordings.id,
				title: recordings.title,
				versionTitle: recordings.versionTitle,
				isrc: recordings.isrc
			})
			.from(recordingCompositions)
			.innerJoin(recordings, eq(recordings.id, recordingCompositions.recordingId))
			.where(eq(recordingCompositions.compositionId, id))
			.orderBy(asc(recordings.title), asc(recordings.versionTitle)),
		db
			.select({
				partyId: parties.id,
				name: parties.displayName,
				role: compositionWriters.role,
				share: compositionWriters.share
			})
			.from(compositionWriters)
			.innerJoin(parties, eq(parties.id, compositionWriters.partyId))
			.where(eq(compositionWriters.compositionId, id))
			.orderBy(sql`${compositionWriters.share} desc`, asc(parties.displayName))
	]);
	return {
		composition,
		recordings: recs,
		writers: writers.map((w) => ({ ...w, share: String(Number(w.share)) }))
	};
}

export async function compositionsForRecording(db: Database, orgId: string, recordingId: string) {
	return db
		.select({ id: compositions.id, title: compositions.title, iswc: compositions.iswc })
		.from(recordingCompositions)
		.innerJoin(compositions, eq(compositions.id, recordingCompositions.compositionId))
		.where(
			and(
				eq(recordingCompositions.orgId, orgId),
				eq(recordingCompositions.recordingId, recordingId)
			)
		)
		.orderBy(asc(compositions.title));
}

/** Recordings to pick from when linking. Small catalogs: the whole list. */
export async function recordingOptions(db: Database, orgId: string) {
	return db
		.select({
			id: recordings.id,
			title: recordings.title,
			versionTitle: recordings.versionTitle,
			isrc: recordings.isrc
		})
		.from(recordings)
		.where(eq(recordings.orgId, orgId))
		.orderBy(asc(sql`lower(${recordings.title})`), asc(recordings.versionTitle));
}

export const CompositionEdit = z.object({
	title: z.string().trim().min(1, 'Title is required'),
	iswc: z
		.string()
		.default('')
		.transform(normalizeIswc)
		.refine((v) => v == null || isValidIswc(v), { message: 'ISWC must look like T-123.456.789-0' })
});

export async function updateComposition(
	db: Database,
	ctx: EditCtx,
	id: string,
	input: unknown,
	expectedUpdatedAt: string | null
) {
	const parsed = CompositionEdit.safeParse(input);
	if (!parsed.success) throw new EditError(fieldsFrom(parsed.error));
	const next = parsed.data;
	return withAudit(db, ctx, async (tx, audit) => {
		const [cur] = await tx
			.select()
			.from(compositions)
			.where(and(eq(compositions.orgId, ctx.orgId), eq(compositions.id, id)))
			.for('update');
		if (!cur) throw new EditError({ form: 'Composition not found' });
		if (!expectedUpdatedAt || cur.updatedAt.toISOString() !== expectedUpdatedAt) {
			throw new EditError({
				form: 'Someone changed this composition after you opened it. Reload the page and try again.'
			});
		}
		if (next.title === cur.title && next.iswc === cur.iswc) {
			throw new NoChange({ changed: false as const });
		}
		if (next.iswc && next.iswc !== cur.iswc) {
			const [clash] = await tx
				.select({ title: compositions.title })
				.from(compositions)
				.where(and(eq(compositions.orgId, ctx.orgId), eq(compositions.iswc, next.iswc)));
			if (clash) throw new EditError({ iswc: `ISWC already used by "${clash.title}"` });
		}
		await tx
			.update(compositions)
			.set({ ...next, updatedAt: new Date() })
			.where(eq(compositions.id, id));
		await audit({
			entity: 'composition',
			entityId: id,
			action: 'edit',
			before: { title: cur.title, iswc: cur.iswc },
			after: next
		});
		return { changed: true as const };
	});
}

/** Link or unlink a recording and a composition. */
export async function setRecordingLink(
	db: Database,
	ctx: EditCtx,
	compositionId: string,
	recordingId: string,
	linked: boolean
) {
	const ids = z.object({ compositionId: z.uuid(), recordingId: z.uuid() }).safeParse({
		compositionId,
		recordingId
	});
	if (!ids.success) throw new EditError({ recordingId: 'Choose a recording' });
	return withAudit(db, ctx, async (tx, audit) => {
		const [comp] = await tx
			.select({ id: compositions.id })
			.from(compositions)
			.where(and(eq(compositions.orgId, ctx.orgId), eq(compositions.id, compositionId)));
		const [rec] = await tx
			.select({ id: recordings.id })
			.from(recordings)
			.where(and(eq(recordings.orgId, ctx.orgId), eq(recordings.id, recordingId)));
		if (!comp || !rec) throw new EditError({ recordingId: 'Unknown recording or composition' });
		const where = and(
			eq(recordingCompositions.compositionId, compositionId),
			eq(recordingCompositions.recordingId, recordingId)
		);
		const [exists] = await tx.select().from(recordingCompositions).where(where);
		if (!!exists === linked) throw new NoChange({ changed: false as const });
		if (linked) {
			await tx
				.insert(recordingCompositions)
				.values({ orgId: ctx.orgId, compositionId, recordingId });
		} else {
			await tx.delete(recordingCompositions).where(where);
		}
		await audit({
			entity: 'composition',
			entityId: compositionId,
			action: linked ? 'link_recording' : 'unlink_recording',
			after: { recordingId }
		});
		return { changed: true as const };
	});
}

/** Turn the writers editor's rows (writer_N, role_N, share_N) into setWriters input. */
export function writersFromForm(fields: Record<string, string>) {
	const writers: Record<string, string>[] = [];
	for (let i = 0; i < 20; i++) {
		const partyId = fields[`writer_${i}`]?.trim() ?? '';
		const share = fields[`share_${i}`]?.trim() ?? '';
		if (!partyId && !share) continue;
		writers.push({ partyId, role: fields[`role_${i}`] || 'composer_lyricist', share });
	}
	return writers;
}
