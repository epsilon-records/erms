import { requireRemovalConfirmation } from '#lib/server/removal-confirmation.js';
import { error, fail, redirect } from '@sveltejs/kit';
import { authAdmin, InviteRefused, type MemberAccount } from '#lib/server/auth-admin.js';
import { editAction, formFields } from '#lib/server/form.js';
import { requireScope } from '#lib/server/guard.js';
import {
	addMember,
	canManageMembers,
	changeRole,
	inviteSchema,
	listMembers,
	onboardingState,
	removeMember
} from '#lib/server/members.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * Members of the active label, for its owners (roles:manage). Every read and write runs through
 * locals.db under RLS; the database refuses anything an owner of this org may not do. The Auth
 * admin client (auth-admin.ts) is used for exactly two things here: sending an invite, and showing
 * each member's address and whether they have signed in.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const m = requireScope(locals, 'roles:manage');
	const rows = await locals.db((tx) => listMembers(tx, m.orgId));
	const admin = authAdmin();

	let accounts: Map<string, MemberAccount> | null = null;
	if (admin) {
		try {
			accounts = await admin.accounts(rows.map((r) => r.userId));
		} catch (e) {
			// The list still works without addresses; say so instead of failing the page.
			console.error(
				JSON.stringify({ level: 'warn', msg: 'member accounts lookup failed', e: String(e) })
			);
		}
	}

	return {
		orgName: m.orgName,
		me: locals.user!.id,
		invitesOn: Boolean(admin),
		members: rows.map((r) => {
			const account = accounts?.get(r.userId);
			return {
				userId: r.userId,
				role: r.role,
				since: r.createdAt.toISOString().slice(0, 10),
				email: account?.email ?? null,
				state: onboardingState(r.onboardedAt, account?.lastSignInAt)
			};
		})
	};
};

const ctxFor = (locals: App.Locals) => {
	const m = requireScope(locals, 'roles:manage');
	return { m, ctx: { orgId: m.orgId, actor: { id: locals.user!.id, kind: 'user' as const } } };
};

export const actions: Actions = {
	invite: async ({ request, locals }) => {
		const { m, ctx } = ctxFor(locals);
		const f = await formFields(request);
		const parsed = inviteSchema.safeParse(f);
		if (!parsed.success) {
			const errors: Record<string, string> = {};
			for (const issue of parsed.error.issues)
				errors[String(issue.path[0] ?? 'form')] = issue.message;
			return fail(400, { action: 'invite', ok: false as const, errors, values: f });
		}

		const admin = authAdmin();
		if (!admin) {
			return fail(503, {
				action: 'invite',
				ok: false as const,
				errors: { form: 'Invites are off on this deploy: the Supabase secret key is not set.' },
				values: f
			});
		}

		// Ask the database, not the session, before any email goes out. The insert below is refused
		// by RLS anyway; this check only keeps a refused invite from sending mail first.
		if (!(await locals.db((tx) => canManageMembers(tx, m.orgId)))) {
			error(403, 'Only an owner of this label can invite members.');
		}

		let invited;
		try {
			invited = await admin.invite(parsed.data.email, m.orgName);
		} catch (e) {
			if (e instanceof InviteRefused) {
				return fail(400, {
					action: 'invite',
					ok: false as const,
					errors: { email: e.message },
					values: f
				});
			}
			throw e;
		}

		return editAction('invite', f, async () => {
			const outcome = await locals.db((tx) =>
				addMember(tx, ctx, {
					userId: invited.userId,
					role: parsed.data.role,
					emailed: invited.emailed
				})
			);
			return { outcome, email: parsed.data.email };
		});
	},

	role: async ({ request, locals }) => {
		const { ctx } = ctxFor(locals);
		const f = await formFields(request);
		const result = await editAction('role', f, () =>
			locals.db((tx) => changeRole(tx, ctx, f.userId, f.role))
		);
		// An owner who stepped down no longer holds roles:manage.
		if (f.userId === ctx.actor.id && 'ok' in result && result.ok && f.role !== 'owner')
			redirect(303, '/');
		return result;
	},

	remove: async ({ request, locals }) => {
		const { ctx } = ctxFor(locals);
		const f = await formFields(request);
		if (!f.userId) {
			return fail(400, {
				action: 'remove',
				ok: false as const,
				errors: { form: 'No member chosen.' },
				values: f
			});
		}
		const result = await editAction(
			'remove',
			f,
			() => (requireRemovalConfirmation(f), locals.db((tx) => removeMember(tx, ctx, f.userId)))
		);
		if (f.userId === ctx.actor.id && 'ok' in result && result.ok) redirect(303, '/');
		return result;
	}
};
