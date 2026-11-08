import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { withAudit, type Database } from './audit';
import { memberships, orgs } from './db/schema';

export const MEMBER_ROLES = ['owner', 'catalog_manager', 'rights_admin', 'viewer'] as const;
export const memberInput = z.object({
	email: z.email().transform((s) => s.trim().toLowerCase()),
	role: z.enum(MEMBER_ROLES)
});
export const roleInput = z.object({ userId: z.uuid(), role: z.enum(MEMBER_ROLES) });
export type MemberRole = (typeof MEMBER_ROLES)[number];
type Context = { orgId: string; actor: { id: string; kind: 'user' } };
export class MemberError extends Error {}

export function listMembers(db: Database, orgId: string) {
	return db
		.select()
		.from(memberships)
		.where(eq(memberships.orgId, orgId))
		.orderBy(memberships.createdAt);
}

/** Generate a credential, never send email, while the org's member mutations are serialized. */
export async function inviteMember(
	db: Database,
	ctx: Context,
	input: z.infer<typeof memberInput>,
	generate: (email: string) => Promise<{ userId: string; tokenHash: string }>
) {
	return withAudit(db, ctx, async (tx, audit) => {
		await tx.execute(sql`select app.lock_members(${ctx.orgId}::uuid)`);
		const existing = await tx
			.select()
			.from(memberships)
			.where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.email, input.email)));
		if (existing.length)
			throw new MemberError('This person is already a member. Use Resend invitation if needed.');
		const [org] = await tx.select({ name: orgs.name }).from(orgs).where(eq(orgs.id, ctx.orgId));
		if (!org) throw new MemberError('Label not found.');
		const link = await generate(input.email);
		if (
			(
				await tx
					.select()
					.from(memberships)
					.where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, link.userId)))
			).length
		)
			throw new MemberError('This person is already a member.');
		await tx.execute(
			sql`select app.add_member(${ctx.orgId}::uuid, ${link.userId}::uuid, ${input.email}, ${input.role}::public.role)`
		);
		await audit({
			entity: 'membership',
			entityId: link.userId,
			action: 'invited',
			after: { email: input.email, role: input.role }
		});
		return { ...link, orgName: org.name };
	});
}

export async function changeMember(
	db: Database,
	ctx: Context,
	userId: string,
	role: MemberRole | null
) {
	return withAudit(db, ctx, async (tx, audit) => {
		await tx.execute(sql`select app.lock_members(${ctx.orgId}::uuid)`);
		const [before] = await tx
			.select()
			.from(memberships)
			.where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, userId)));
		if (!before) throw new MemberError('Member not found in this label.');
		// Record before removal so the actor can remove their own membership and still audit it.
		await audit({
			entity: 'membership',
			entityId: userId,
			action: role ? 'role_changed' : 'removed',
			before: { email: before.email, role: before.role },
			after: role ? { email: before.email, role } : null
		});
		if (role)
			await tx.execute(
				sql`select app.change_member_role(${ctx.orgId}::uuid,${userId}::uuid,${role}::public.role)`
			);
		else await tx.execute(sql`select app.remove_member(${ctx.orgId}::uuid,${userId}::uuid)`);
	});
}

export async function resendInvitation(
	db: Database,
	ctx: Context,
	userId: string,
	generate: (email: string) => Promise<{ userId: string; tokenHash: string }>
) {
	return withAudit(db, ctx, async (tx, audit) => {
		await tx.execute(sql`select app.lock_members(${ctx.orgId}::uuid)`);
		const [member] = await tx
			.select()
			.from(memberships)
			.where(and(eq(memberships.orgId, ctx.orgId), eq(memberships.userId, userId)));
		if (!member?.email || member.onboardedAt)
			throw new MemberError(
				'Only an invited member awaiting onboarding can receive another invitation.'
			);
		const [org] = await tx.select().from(orgs).where(eq(orgs.id, ctx.orgId));
		const link = await generate(member.email);
		if (link.userId !== userId)
			throw new MemberError(
				'The email no longer matches this member. Remove the invitation and invite again.'
			);
		await audit({
			entity: 'membership',
			entityId: userId,
			action: 'invite_resent',
			after: { email: member.email, role: member.role }
		});
		return { ...link, orgName: org.name, email: member.email };
	});
}
