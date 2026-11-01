import { error } from '@sveltejs/kit';
import { getRecording } from '#lib/server/catalog.js';
import {
	addCredit,
	approveCredit,
	removeCredit,
	updateRecording
} from '#lib/server/catalog-edit.js';
import { db } from '#lib/server/db/client.js';
import { editAction, formFields } from '#lib/server/form.js';
import { requireScope } from '#lib/server/guard.js';
import { hasScope } from '#lib/server/rbac.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const m = requireScope(locals, 'catalog:read');
	if (!/^[0-9a-f-]{36}$/.test(params.id)) error(404, 'Recording not found');
	const data = await getRecording(db(), m.orgId, params.id);
	if (!data) error(404, 'Recording not found');
	return {
		...data,
		can: { edit: hasScope(m.role, 'catalog:write'), approve: hasScope(m.role, 'metadata:approve') }
	};
};

const ctxFor = (locals: App.Locals, scope: 'catalog:write' | 'metadata:approve') => {
	const m = requireScope(locals, scope);
	return { orgId: m.orgId, actor: { id: locals.user!.id, kind: 'user' as const } };
};

export const actions: Actions = {
	save: async ({ request, locals, params }) => {
		const ctx = ctxFor(locals, 'catalog:write');
		const f = await formFields(request);
		return editAction('save', f, () => updateRecording(db(), ctx, params.id, f, f.updatedAt));
	},
	addCredit: async ({ request, locals, params }) => {
		const ctx = ctxFor(locals, 'catalog:write');
		const f = await formFields(request);
		return editAction('addCredit', f, () => addCredit(db(), ctx, { recordingId: params.id }, f));
	},
	removeCredit: async ({ request, locals }) => {
		const ctx = ctxFor(locals, 'catalog:write');
		const f = await formFields(request);
		return editAction('removeCredit', f, () => removeCredit(db(), ctx, f.creditId));
	},
	approveCredit: async ({ request, locals }) => {
		const ctx = ctxFor(locals, 'metadata:approve');
		const f = await formFields(request);
		return editAction('approveCredit', f, () => approveCredit(db(), ctx, f.creditId));
	}
};
