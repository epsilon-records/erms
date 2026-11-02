import { editAction, formFields } from '#lib/server/form.js';
import { requireScope } from '#lib/server/guard.js';
import { hasScope } from '#lib/server/rbac.js';
import { createAgreement, holderOptions, listAgreements } from '#lib/server/rights.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const m = requireScope(locals, 'agreements:read');
	const canWrite = hasScope(m.role, 'rights:write');
	return {
		agreements: await locals.db((tx) => listAgreements(tx, m.orgId)),
		options: canWrite ? await locals.db((tx) => holderOptions(tx, m.orgId)) : null
	};
};

export const actions: Actions = {
	create: async ({ request, locals }) => {
		const m = requireScope(locals, 'rights:write');
		const ctx = { orgId: m.orgId, actor: { id: locals.user!.id, kind: 'user' as const } };
		const f = await formFields(request);
		return editAction('create', f, () => locals.db((tx) => createAgreement(tx, ctx, f)));
	}
};
