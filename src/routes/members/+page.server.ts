import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { PUBLIC_SUPABASE_URL } from '$app/env/public';
import { SUPABASE_SECRET_KEY, RESEND_API_KEY } from '$app/env/private';
import { requireScope } from '#lib/server/guard.js';
import {
	listMembers,
	inviteMember,
	changeMember,
	resendInvitation,
	memberInput,
	roleInput,
	MemberError,
	MEMBER_ROLES
} from '#lib/server/members.js';
import { invitationDelivery } from '#lib/server/invitation-mail.js';
import type { Actions, PageServerLoad } from './$types';

const configured = () => Boolean(SUPABASE_SECRET_KEY && RESEND_API_KEY);
export const load: PageServerLoad = async ({ locals }) => {
	const m = requireScope(locals, 'roles:manage');
	return {
		members: await locals.db((db) => listMembers(db, m.orgId)),
		orgName: m.orgName,
		roles: MEMBER_ROLES,
		canInvite: configured()
	};
};
function message(error: unknown) {
	if (error instanceof MemberError) return error.message;
	const cause = (error as { cause?: { code?: string } })?.cause ?? (error as { code?: string });
	if (cause?.code === '23514') return 'A label must keep at least one owner.';
	if (cause?.code === '42501') return 'Only a current owner of this label can manage members.';
	return 'The member change could not be completed. Refresh the page and try again.';
}
export const actions: Actions = {
	invite: async ({ locals, request }) => {
		const m = requireScope(locals, 'roles:manage');
		if (!configured()) return fail(503, { error: 'Invitations are not configured yet.' });
		const input = memberInput.safeParse(Object.fromEntries(await request.formData()));
		if (!input.success)
			return fail(400, { error: 'Enter a valid email and choose a member role.' });
		const delivery = invitationDelivery({
			url: PUBLIC_SUPABASE_URL,
			secretKey: SUPABASE_SECRET_KEY!,
			resendKey: RESEND_API_KEY!
		});
		let prepared;
		try {
			prepared = await locals.db((db) =>
				inviteMember(
					db,
					{ orgId: m.orgId, actor: { id: locals.user!.id, kind: 'user' } },
					input.data,
					delivery.generate
				)
			);
		} catch (e) {
			return fail(400, { error: message(e) });
		}
		try {
			await delivery.send({ ...prepared, email: input.data.email, orgId: m.orgId });
		} catch {
			return fail(502, {
				error:
					'The member was added, but email delivery was not confirmed. Check the recipient inbox before using Resend invitation; a new link invalidates the previous one.'
			});
		}
		return { success: `Invitation sent for ${m.orgName}.` };
	},
	role: async ({ locals, request }) => {
		const m = requireScope(locals, 'roles:manage');
		const input = roleInput.safeParse(Object.fromEntries(await request.formData()));
		if (!input.success) return fail(400, { error: 'Choose a valid member and role.' });
		try {
			await locals.db((db) =>
				changeMember(
					db,
					{ orgId: m.orgId, actor: { id: locals.user!.id, kind: 'user' } },
					input.data.userId,
					input.data.role
				)
			);
		} catch (e) {
			return fail(400, { error: message(e) });
		}
		return { success: 'Role updated.' };
	},
	remove: async ({ locals, request }) => {
		const m = requireScope(locals, 'roles:manage');
		const userId = z.uuid().safeParse((await request.formData()).get('userId'));
		if (!userId.success) return fail(400, { error: 'Choose a valid member.' });
		try {
			await locals.db((db) =>
				changeMember(
					db,
					{ orgId: m.orgId, actor: { id: locals.user!.id, kind: 'user' } },
					userId.data,
					null
				)
			);
		} catch (e) {
			return fail(400, { error: message(e) });
		}
		return { success: 'Member removed.' };
	},
	resend: async ({ locals, request }) => {
		const m = requireScope(locals, 'roles:manage');
		if (!configured()) return fail(503, { error: 'Invitations are not configured yet.' });
		const userId = z.uuid().safeParse((await request.formData()).get('userId'));
		if (!userId.success) return fail(400, { error: 'Choose a valid member.' });
		const delivery = invitationDelivery({
			url: PUBLIC_SUPABASE_URL,
			secretKey: SUPABASE_SECRET_KEY!,
			resendKey: RESEND_API_KEY!
		});
		let prepared;
		try {
			prepared = await locals.db((db) =>
				resendInvitation(
					db,
					{ orgId: m.orgId, actor: { id: locals.user!.id, kind: 'user' } },
					userId.data,
					delivery.generate
				)
			);
		} catch (e) {
			return fail(400, { error: message(e) });
		}
		try {
			await delivery.send({ ...prepared, orgId: m.orgId });
		} catch {
			return fail(502, {
				error: 'Email delivery was not confirmed. Check the recipient inbox before retrying.'
			});
		}
		return { success: 'Invitation sent again. Previous links are no longer valid.' };
	}
};
