import { redirect } from '@sveltejs/kit';
import { editAction, formFields } from '#lib/server/form.js';
import { requireScope } from '#lib/server/guard.js';
import { hasScope } from '#lib/server/rbac.js';
import { createComposition, listCompositions } from '#lib/server/rights.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const m = requireScope(locals, 'catalog:read');
	return {
		compositions: await locals.db((tx) => listCompositions(tx, m.orgId)),
		canWrite: hasScope(m.role, 'rights:write')
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const m = requireScope(locals, 'rights:write');
		const ctx = { orgId: m.orgId, actor: { id: locals.user!.id, kind: 'user' as const } };
		const f = await formFields(request);
		const res = await editAction('create', f, () =>
			locals.db((tx) => createComposition(tx, ctx, { title: f.title, iswc: f.iswc }))
		);
		if ('ok' in res && res.ok) redirect(303, `/compositions/${res.result.id}`);
		return res;
	}
};
