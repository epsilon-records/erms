import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from './audit';
import { uuidv7 } from './db/uuidv7';

/**
 * Self-serve label creation (EPSILON-130). The database function app.create_org does the work in
 * the caller's own RLS-scoped transaction: it creates the org, makes the caller (always
 * app.current_user_id()) its owner and writes the audit entry.
 */

export const labelForm = z.object({
	name: z
		.string()
		.trim()
		.min(1, 'Name your label.')
		.max(120, 'Keep the name under 120 characters.'),
	slug: z
		.string()
		.trim()
		.toLowerCase()
		.regex(
			/^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/,
			'Use 1–40 lowercase letters, digits or hyphens, starting and ending with a letter or digit.'
		)
});

export { slugFromName } from '../slug';

export type CreateLabelResult =
	{ ok: true; orgId: string } | { ok: false; reason: 'slug_taken' | 'limit' | 'invalid' };

/** Create a label owned by the scoped user. `tx` must be an labelkit_app transaction (locals.db). */
export async function createLabel(
	tx: Database,
	input: { name: string; slug: string }
): Promise<CreateLabelResult> {
	const orgId = uuidv7();
	try {
		// A savepoint, so a refused create leaves the request's transaction usable.
		await tx.transaction((sp) =>
			sp.execute(sql`select app.create_org(${orgId}::uuid, ${input.name}, ${input.slug})`)
		);
		return { ok: true, orgId };
	} catch (err) {
		const code = pgCode(err);
		if (code === '23505') return { ok: false, reason: 'slug_taken' };
		if (code === '54000') return { ok: false, reason: 'limit' };
		if (code === '22023') return { ok: false, reason: 'invalid' };
		throw err;
	}
}

function pgCode(err: unknown): string | undefined {
	const e = err as { code?: string; cause?: { code?: string } };
	return e?.cause?.code ?? e?.code;
}
