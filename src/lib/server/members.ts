import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { NoChange, withAudit, type Actor, type Database } from './audit';
import { EditError } from './catalog-edit';
import { memberships, type Role } from './db/schema';

/**
 * Members of an org: list, invite (add), change role, remove (EPSILON-87).
 *
 * Every function takes the request's RLS-scoped transaction. The database is the authority:
 * the memberships policies let only an owner of the org write its rows, an insert naming
 * another org is refused, `agent` cannot be handed out, and the `memberships_keep_one_owner`
 * trigger keeps one owner per org (drizzle/0017_members_manage.sql). The checks here only turn
 * those refusals into messages an owner can act on.
 */

/** The roles a person can hold. `agent` is for machine tokens and is never offered. */
export const MEMBER_ROLES = ['owner', 'catalog_manager', 'rights_admin', 'viewer'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export const ROLE_LABELS: Record<MemberRole, string> = {
	owner: 'Owner',
	catalog_manager: 'Catalog manager',
	rights_admin: 'Rights admin',
	viewer: 'Viewer'
};

const roleSchema = z.enum(MEMBER_ROLES, { error: 'Choose a role.' });

export const inviteSchema = z.object({
	email: z
		.string()
		.trim()
		.toLowerCase()
		.pipe(z.email({ error: 'Enter a valid email address.' })),
	role: roleSchema
});

type Ctx = { orgId: string; actor: Actor };

export type MemberRow = {
	userId: string;
	role: Role;
	createdAt: Date;
	onboardedAt: Date | null;
};

const LAST_OWNER =
	'A label must keep at least one owner. Make someone else an owner first, then try again.';
const NOT_OWNER = 'Only an owner of this label can manage its members.';

/** The SQLSTATE behind Drizzle's wrapper, if any. */
function pgCode(e: unknown): { code?: string; constraint?: string } {
	const err = e as { code?: string; constraint_name?: string; cause?: unknown };
	const cause = (err?.cause ?? err) as { code?: string; constraint_name?: string };
	return { code: cause?.code, constraint: cause?.constraint_name };
}

/** Turn the database's refusals into form errors; anything else is a real failure. */
async function refusals<T>(run: () => Promise<T>): Promise<T> {
	try {
		return await run();
	} catch (e) {
		if (e instanceof EditError || e instanceof NoChange) throw e;
		const { code, constraint } = pgCode(e);
		if (code === '23514' && constraint === 'memberships_keep_one_owner') {
			throw new EditError({ form: LAST_OWNER });
		}
		if (code === '42501') throw new EditError({ form: NOT_OWNER });
		throw e;
	}
}

export async function listMembers(db: Database, orgId: string): Promise<MemberRow[]> {
	return db
		.select({
			userId: memberships.userId,
			role: memberships.role,
			createdAt: memberships.createdAt,
			onboardedAt: memberships.onboardedAt
		})
		.from(memberships)
		.where(eq(memberships.orgId, orgId))
		.orderBy(asc(memberships.createdAt), asc(memberships.userId));
}

/** Whether the caller is an owner of `orgId`, asked of the database rather than the session. */
export async function canManageMembers(db: Database, orgId: string): Promise<boolean> {
	const rows = (await db.execute(
		sql`select app.has_role(${orgId}::uuid, array['owner']) as ok`
	)) as unknown as { ok: boolean }[];
	return Boolean(rows[0]?.ok);
}

/**
 * Add an account to the org with a role: the database half of an invite. Returns `'added'`,
 * or `'already'` when the person is already a member (nothing changes then).
 */
export async function addMember(
	db: Database,
	ctx: Ctx,
	input: { userId: string; role: string; emailed: boolean }
): Promise<'added' | 'already'> {
	const role = roleSchema.parse(input.role);
	return withAudit(db, ctx, (tx, audit) =>
		refusals(async () => {
			const inserted = await tx
				.insert(memberships)
				.values({ orgId: ctx.orgId, userId: input.userId, role })
				.onConflictDoNothing()
				.returning({ userId: memberships.userId });
			if (!inserted.length) throw new NoChange('already' as const);
			// No address in the log: it is append-only and outlives the account (decision 0022).
			await audit({
				entity: 'membership',
				entityId: input.userId,
				action: 'member_invite',
				after: { role, emailed: input.emailed }
			});
			return 'added' as const;
		})
	);
}

// Lock the membership before reading its audit value. UPDATE/DELETE already take this row
// lock before the last-owner trigger locks the org. Its owner count uses an MVCC read, not
// membership locks, so concurrent single-member changes do not invert that lock order.
async function current(db: Database, orgId: string, userId: string) {
	const [row] = await db
		.select({ role: memberships.role })
		.from(memberships)
		.where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)))
		.for('update');
	if (!row) throw new EditError({ form: 'That person is not a member of this label.' });
	return row;
}

export async function changeRole(db: Database, ctx: Ctx, userId: string, rawRole: string) {
	const parsed = roleSchema.safeParse(rawRole);
	if (!parsed.success) throw new EditError({ role: 'Choose a role.' });
	const role = parsed.data;
	return withAudit(db, ctx, (tx, audit) =>
		refusals(async () => {
			const before = await current(tx, ctx.orgId, userId);
			if (before.role === role) throw new NoChange(role);
			const updated = await tx
				.update(memberships)
				.set({ role })
				.where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, userId)))
				.returning({ userId: memberships.userId });
			// RLS filters a non-owner's update to nothing rather than raising.
			if (!updated.length) throw new EditError({ form: NOT_OWNER });
			await audit({
				entity: 'membership',
				entityId: userId,
				action: 'member_role',
				before: { role: before.role },
				after: { role }
			});
			return role;
		})
	);
}

export async function removeMember(db: Database, ctx: Ctx, userId: string) {
	return withAudit(db, ctx, (tx, audit) =>
		refusals(async () => {
			const before = await current(tx, ctx.orgId, userId);
			// Audited first: an owner removing themselves is no longer a member afterwards, and the
			// audit policy only accepts entries from members. Same transaction, so it still rolls
			// back with the delete.
			await audit({
				entity: 'membership',
				entityId: userId,
				action: 'member_remove',
				before: { role: before.role }
			});
			const deleted = await tx
				.delete(memberships)
				.where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, userId)))
				.returning({ userId: memberships.userId });
			if (!deleted.length) throw new EditError({ form: NOT_OWNER });
			return userId;
		})
	);
}

export type OnboardingState = 'onboarded' | 'signed_in' | 'invited' | 'unknown';

/** Where a member is: invited and never signed in, signed in but not onboarded, or done. */
export function onboardingState(
	onboardedAt: Date | null,
	lastSignInAt: string | null | undefined
): OnboardingState {
	if (onboardedAt) return 'onboarded';
	if (lastSignInAt === undefined) return 'unknown';
	return lastSignInAt ? 'signed_in' : 'invited';
}
