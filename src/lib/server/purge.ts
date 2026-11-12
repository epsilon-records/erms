import { and, asc, eq, isNotNull, lte, sql } from 'drizzle-orm';
import type { Database } from '#lib/server/audit.js';
import { audiokitLabelClients, masters, orgs } from '#lib/server/db/schema.js';
import type { MasterStorage } from '#lib/server/storage/r2.js';

/**
 * Closing and purging a label (migration 0027; privacy notice section 6).
 *
 * Owners close a label through app.close_org and can reopen it until purge_after (30 days). The
 * scheduled purge job then, per label: revokes its AudioKit client, deletes every object under
 * orgs/<id>/ in R2 (masters and AudioKit outputs), and only then calls app.purge_org, which deletes
 * every row the label owns and the org itself. A failure at any step leaves the label for the next
 * run; nothing is half-deleted in the database.
 */

export class PurgeError extends Error {
	constructor(
		readonly status: 400 | 403,
		message: string
	) {
		super(message);
	}
}

const codeOf = (e: unknown) =>
	(e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code;

/** Close the caller's label (owners only; the database checks). Returns when it will be purged. */
export async function closeOrg(tx: Database, orgId: string): Promise<Date> {
	try {
		const rows = (await tx.execute(
			sql`select app.close_org(${orgId}::uuid) as purge_after`
		)) as unknown as Array<{ purge_after: string | Date }>;
		return new Date(rows[0].purge_after);
	} catch (e) {
		if (codeOf(e) === '42501') throw new PurgeError(403, 'Only an owner can close this label.');
		throw e;
	}
}

export async function reopenOrg(tx: Database, orgId: string): Promise<void> {
	try {
		await tx.execute(sql`select app.reopen_org(${orgId}::uuid)`);
	} catch (e) {
		if (codeOf(e) === '42501') throw new PurgeError(403, 'Only an owner can reopen this label.');
		throw e;
	}
}

export type PurgeDeps = {
	storage: MasterStorage | null;
	/** Revokes a label's AudioKit client at billing; null when billing isn't configured. */
	revokeClient: ((clientId: string) => Promise<unknown>) | null;
	log?: (entry: Record<string, unknown>) => void;
};

/** Labels whose grace period has ended, oldest first. Owner connection. */
export function duePurges(owner: Database, now = new Date(), limit = 5) {
	return owner
		.select({ id: orgs.id })
		.from(orgs)
		.where(and(isNotNull(orgs.closedAt), lte(orgs.purgeAfter, now)))
		.orderBy(asc(orgs.purgeAfter))
		.limit(limit);
}

/** Purge one label. Owner connection only (purge.ts is called from the worker route). */
export async function purgeOrg(owner: Database, orgId: string, deps: PurgeDeps): Promise<boolean> {
	const log = deps.log ?? ((entry) => console.log(JSON.stringify(entry)));
	if (deps.revokeClient) {
		const clients = await owner
			.select({ clientId: audiokitLabelClients.clientId })
			.from(audiokitLabelClients)
			.where(eq(audiokitLabelClients.orgId, orgId));
		for (const c of clients) await deps.revokeClient(c.clientId);
	}
	if (deps.storage) {
		const keys = await deps.storage.list(`orgs/${orgId}/`);
		for (const key of keys) await deps.storage.remove(key);
		log({ level: 'info', msg: 'purge: storage cleared', org: orgId, objects: keys.length });
	} else {
		// Without storage the files can't be deleted, so the rows that point at them must stay.
		const [held] = await owner
			.select({ id: masters.id })
			.from(masters)
			.where(eq(masters.orgId, orgId))
			.limit(1);
		if (held) {
			log({ level: 'warn', msg: 'purge: storage not configured; label kept', org: orgId });
			return false;
		}
	}
	const rows = (await owner.execute(
		sql`select app.purge_org(${orgId}::uuid) as purged`
	)) as unknown as Array<{ purged: boolean }>;
	const purged = Boolean(rows[0]?.purged);
	log({
		level: 'info',
		msg: purged ? 'purge: label deleted' : 'purge: skipped (reopened)',
		org: orgId
	});
	return purged;
}
