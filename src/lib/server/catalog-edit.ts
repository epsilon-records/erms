import { and, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { type Actor, type Database, NoChange, withAudit } from './audit';
import {
	creditRoleEnum,
	credits,
	labels,
	parties,
	recordings,
	releases,
	releaseTypeEnum
} from './db/schema';
import { uuidv7 } from './db/uuidv7';
import {
	isValidGtin,
	isValidIsrc,
	normalizeIsrc,
	parseDuration,
	partyMatchKey
} from './import/identifiers';

/**
 * Hand edits to the catalog. Every change goes through withAudit with the before and
 * after of the fields that changed. Releases and recordings carry updated_at, and an
 * edit is refused if the row changed since the form was loaded (no silent overwrites).
 */

export type EditCtx = { orgId: string; actor: Actor };

/** A user-facing problem with the submitted form: field name to message. */
export class EditError extends Error {
	constructor(readonly fields: Record<string, string>) {
		super(Object.values(fields).join('; '));
	}
}

const optionalText = z
	.string()
	.trim()
	.transform((s) => (s === '' ? null : s));

const requiredText = (label: string) => z.string().trim().min(1, `${label} is required`);

function issuesToFields(error: z.ZodError): Record<string, string> {
	return Object.fromEntries(error.issues.map((i) => [String(i.path[0] ?? 'form'), i.message]));
}

function diff<T extends Record<string, unknown>>(current: T, next: Partial<T>) {
	const before: Record<string, unknown> = {};
	const after: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(next)) {
		const cur = current[k];
		const same =
			cur instanceof Date && v instanceof Date ? cur.getTime() === v.getTime() : cur === v;
		if (!same) {
			before[k] = cur;
			after[k] = v;
		}
	}
	return { before, after, changed: Object.keys(after).length > 0 };
}

function assertFresh(current: Date, expected: string | null | undefined) {
	if (!expected || current.toISOString() !== expected) {
		throw new EditError({
			form: 'Someone changed this record after you opened it. Reload the page and try again.'
		});
	}
}

/* ------------------------------------------------------------------------- */
/* Releases                                                                   */
/* ------------------------------------------------------------------------- */

export const ReleaseForm = z.object({
	title: requiredText('Title'),
	versionTitle: optionalText,
	type: z.enum(releaseTypeEnum.enumValues),
	releaseDate: optionalText.refine((d) => d == null || /^\d{4}-\d{2}-\d{2}$/.test(d), {
		message: 'Date must be YYYY-MM-DD'
	}),
	catalogNumber: optionalText,
	upc: z
		.string()
		.trim()
		.refine(isValidGtin, { message: 'UPC must be 12 or 13 digits with a valid check digit' }),
	labelId: z.uuid('Choose a label'),
	genre: optionalText,
	subgenre: optionalText
});

export async function updateRelease(
	db: Database,
	ctx: EditCtx,
	id: string,
	input: Record<string, unknown>,
	expectedUpdatedAt: string | null
) {
	const parsed = ReleaseForm.safeParse(input);
	if (!parsed.success) throw new EditError(issuesToFields(parsed.error));
	const next = parsed.data;

	return withAudit(db, ctx, async (tx, audit) => {
		const [cur] = await tx
			.select()
			.from(releases)
			.where(and(eq(releases.orgId, ctx.orgId), eq(releases.id, id)))
			.for('update');
		if (!cur) throw new EditError({ form: 'Release not found' });
		assertFresh(cur.updatedAt, expectedUpdatedAt);

		const [label] = await tx
			.select({ id: labels.id })
			.from(labels)
			.where(and(eq(labels.orgId, ctx.orgId), eq(labels.id, next.labelId)));
		if (!label) throw new EditError({ labelId: 'Unknown label' });

		if (next.upc !== cur.upc) {
			const [clash] = await tx
				.select({ id: releases.id, title: releases.title })
				.from(releases)
				.where(and(eq(releases.orgId, ctx.orgId), eq(releases.upc, next.upc), ne(releases.id, id)));
			if (clash) throw new EditError({ upc: `UPC already used by "${clash.title}"` });
		}

		const { before, after, changed } = diff(cur, next);
		if (!changed) throw new NoChange({ changed: false as const, release: cur });
		const [updated] = await tx
			.update(releases)
			.set({ ...after, updatedAt: new Date() })
			.where(eq(releases.id, id))
			.returning();
		await audit({ entity: 'release', entityId: id, action: 'edit', before, after });
		return { changed: true as const, release: updated };
	});
}

/* ------------------------------------------------------------------------- */
/* Recordings                                                                 */
/* ------------------------------------------------------------------------- */

export const RecordingForm = z.object({
	title: requiredText('Title'),
	versionTitle: optionalText,
	isrc: z
		.string()
		.transform(normalizeIsrc)
		.refine(isValidIsrc, { message: 'ISRC must look like CC-XXX-YY-NNNNN (12 characters)' }),
	duration: z
		.string()
		.trim()
		.transform((s, ctx) => {
			if (s === '') return null;
			const ms = parseDuration(s);
			if (ms == null) {
				ctx.addIssue({ code: 'custom', message: 'Duration must be mm:ss' });
				return z.NEVER;
			}
			return ms;
		}),
	genre: optionalText,
	subgenre: optionalText
});

export async function updateRecording(
	db: Database,
	ctx: EditCtx,
	id: string,
	input: Record<string, unknown>,
	expectedUpdatedAt: string | null
) {
	const parsed = RecordingForm.safeParse(input);
	if (!parsed.success) throw new EditError(issuesToFields(parsed.error));
	const { duration, ...rest } = parsed.data;
	const next = { ...rest, durationMs: duration };

	return withAudit(db, ctx, async (tx, audit) => {
		const [cur] = await tx
			.select()
			.from(recordings)
			.where(and(eq(recordings.orgId, ctx.orgId), eq(recordings.id, id)))
			.for('update');
		if (!cur) throw new EditError({ form: 'Recording not found' });
		assertFresh(cur.updatedAt, expectedUpdatedAt);

		if (next.isrc !== cur.isrc) {
			const [clash] = await tx
				.select({ title: recordings.title })
				.from(recordings)
				.where(
					and(
						eq(recordings.orgId, ctx.orgId),
						eq(recordings.isrc, next.isrc),
						ne(recordings.id, id)
					)
				);
			if (clash) throw new EditError({ isrc: `ISRC already used by "${clash.title}"` });
		}

		const { before, after, changed } = diff(cur, next);
		if (!changed) throw new NoChange({ changed: false as const, recording: cur });
		const [updated] = await tx
			.update(recordings)
			.set({ ...after, updatedAt: new Date() })
			.where(eq(recordings.id, id))
			.returning();
		await audit({ entity: 'recording', entityId: id, action: 'edit', before, after });
		return { changed: true as const, recording: updated };
	});
}

/* ------------------------------------------------------------------------- */
/* Credits                                                                    */
/* ------------------------------------------------------------------------- */

export const CreditForm = z.object({
	name: requiredText('Name'),
	role: z.enum(creditRoleEnum.enumValues)
});

/**
 * Add a credit by artist name; the artist is created if no existing one matches.
 * Hand-added credits start unapproved (pending) until someone with metadata:approve
 * signs them off, as the spec requires for credits that are not from a distributor.
 */
export async function addCredit(
	db: Database,
	ctx: EditCtx,
	target: { recordingId: string } | { releaseId: string },
	input: Record<string, unknown>
) {
	const parsed = CreditForm.safeParse(input);
	if (!parsed.success) throw new EditError(issuesToFields(parsed.error));
	const { name, role } = parsed.data;
	if ('releaseId' in target && role !== 'main') {
		throw new EditError({ role: 'Release credits can only be main artists' });
	}

	return withAudit(db, ctx, async (tx, audit) => {
		// The target must belong to this org.
		if ('recordingId' in target) {
			const [r] = await tx
				.select({ id: recordings.id })
				.from(recordings)
				.where(and(eq(recordings.orgId, ctx.orgId), eq(recordings.id, target.recordingId)));
			if (!r) throw new EditError({ form: 'Recording not found' });
		} else {
			const [r] = await tx
				.select({ id: releases.id })
				.from(releases)
				.where(and(eq(releases.orgId, ctx.orgId), eq(releases.id, target.releaseId)));
			if (!r) throw new EditError({ form: 'Release not found' });
		}

		const matchKey = partyMatchKey(name);
		let [party] = await tx
			.select()
			.from(parties)
			.where(and(eq(parties.orgId, ctx.orgId), eq(parties.matchKey, matchKey)));
		if (!party) {
			[party] = await tx
				.insert(parties)
				.values({ id: uuidv7(), orgId: ctx.orgId, displayName: name, matchKey })
				.returning();
			await audit({ entity: 'party', entityId: party.id, action: 'create', after: party });
		}

		const targetCol =
			'recordingId' in target
				? eq(credits.recordingId, target.recordingId)
				: eq(credits.releaseId, target.releaseId);
		const existing = await tx
			.select()
			.from(credits)
			.where(and(targetCol, eq(credits.partyId, party.id), eq(credits.role, role)));
		if (existing.length)
			throw new EditError({ name: `${party.displayName} already has this credit` });

		const siblings = await tx
			.select({ id: credits.id })
			.from(credits)
			.where(and(targetCol, eq(credits.role, role)));
		const [credit] = await tx
			.insert(credits)
			.values({
				id: uuidv7(),
				orgId: ctx.orgId,
				recordingId: 'recordingId' in target ? target.recordingId : null,
				releaseId: 'releaseId' in target ? target.releaseId : null,
				partyId: party.id,
				role,
				position: siblings.length,
				source: 'manual',
				approvedAt: null,
				approvedBy: null
			})
			.returning();
		await audit({ entity: 'credit', entityId: credit.id, action: 'create', after: credit });
		return credit;
	});
}

async function loadCredit(
	tx: Parameters<Parameters<Database['transaction']>[0]>[0],
	ctx: EditCtx,
	id: string
) {
	const [credit] = await tx
		.select()
		.from(credits)
		.where(and(eq(credits.orgId, ctx.orgId), eq(credits.id, id)))
		.for('update');
	if (!credit) throw new EditError({ form: 'Credit not found' });
	return credit;
}

export async function approveCredit(db: Database, ctx: EditCtx, id: string) {
	return withAudit(db, ctx, async (tx, audit) => {
		const credit = await loadCredit(tx, ctx, id);
		if (credit.approvedAt) throw new EditError({ form: 'Credit is already approved' });
		const approvedAt = new Date();
		await tx
			.update(credits)
			.set({ approvedAt, approvedBy: ctx.actor.id })
			.where(eq(credits.id, id));
		await audit({
			entity: 'credit',
			entityId: id,
			action: 'approve',
			before: { approvedAt: null },
			after: { approvedAt, approvedBy: ctx.actor.id }
		});
	});
}

export async function removeCredit(db: Database, ctx: EditCtx, id: string) {
	return withAudit(db, ctx, async (tx, audit) => {
		const credit = await loadCredit(tx, ctx, id);
		if (credit.releaseId && credit.role === 'main') {
			const mains = await tx
				.select({ id: credits.id })
				.from(credits)
				.where(and(eq(credits.releaseId, credit.releaseId), eq(credits.role, 'main')));
			if (mains.length <= 1) {
				throw new EditError({ form: 'A release needs at least one main artist' });
			}
		}
		if (credit.recordingId && credit.role === 'main') {
			const mains = await tx
				.select({ id: credits.id })
				.from(credits)
				.where(and(eq(credits.recordingId, credit.recordingId), eq(credits.role, 'main')));
			if (mains.length <= 1) {
				throw new EditError({ form: 'A recording needs at least one main artist' });
			}
		}
		await tx.delete(credits).where(eq(credits.id, id));
		await audit({ entity: 'credit', entityId: id, action: 'delete', before: credit });
	});
}

/* ------------------------------------------------------------------------- */
/* Artists                                                                    */
/* ------------------------------------------------------------------------- */

export async function renameParty(
	db: Database,
	ctx: EditCtx,
	id: string,
	input: Record<string, unknown>
) {
	const parsed = z.object({ displayName: requiredText('Name') }).safeParse(input);
	if (!parsed.success) throw new EditError(issuesToFields(parsed.error));
	const displayName = parsed.data.displayName.replace(/\s+/g, ' ');
	const matchKey = partyMatchKey(displayName);

	return withAudit(db, ctx, async (tx, audit) => {
		const [cur] = await tx
			.select()
			.from(parties)
			.where(and(eq(parties.orgId, ctx.orgId), eq(parties.id, id)))
			.for('update');
		if (!cur) throw new EditError({ form: 'Artist not found' });
		if (cur.displayName === displayName) throw new NoChange({ changed: false as const });
		if (matchKey !== cur.matchKey) {
			const [clash] = await tx
				.select({ id: parties.id })
				.from(parties)
				.where(and(eq(parties.orgId, ctx.orgId), eq(parties.matchKey, matchKey)));
			if (clash) {
				throw new EditError({
					displayName: `Another artist is already called "${displayName}". Merging artists comes later.`
				});
			}
		}
		await tx.update(parties).set({ displayName, matchKey }).where(eq(parties.id, id));
		await audit({
			entity: 'party',
			entityId: id,
			action: 'rename',
			before: { displayName: cur.displayName },
			after: { displayName }
		});
		return { changed: true as const };
	});
}
