import { error, redirect } from '@sveltejs/kit';
import { getRelease, listLabels } from '#lib/server/catalog.js';
import { addCredit, approveCredit, removeCredit, updateRelease } from '#lib/server/catalog-edit.js';
import { db } from '#lib/server/db/client.js';
import { editAction, formFields } from '#lib/server/form.js';
import { requireScope } from '#lib/server/guard.js';
import { hasScope } from '#lib/server/rbac.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const m = requireScope(locals, 'catalog:write');
	if (!/^[0-9a-f-]{36}$/.test(params.id)) error(404, 'Release not found');
	const release = await getRelease(db(), m.orgId, params.id);
	if (!release) error(404, 'Release not found');
	return {
		release,
		labels: await listLabels(db(), m.orgId),
		can: { approve: hasScope(m.role, 'metadata:approve') }
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
		const res = await editAction('save', f, () =>
			updateRelease(db(), ctx, params.id, f, f.updatedAt)
		);
		if ('ok' in res && res.ok) redirect(303, `/releases/${params.id}`);
		return res;
	},
	// Release-level credits are the release's main artists.
	addCredit: async ({ request, locals, params }) => {
		const ctx = ctxFor(locals, 'catalog:write');
		const f = await formFields(request);
		return editAction('addCredit', f, () =>
			addCredit(db(), ctx, { releaseId: params.id }, { ...f, role: 'main' })
		);
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
