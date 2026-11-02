import { editAction, formFields } from '#lib/server/form.js';
import { requireScope } from '#lib/server/guard.js';
import { hasScope } from '#lib/server/rbac.js';
import { claimMastersForLabel, masterCoverage, openMastersByLabel } from '#lib/server/rights.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const m = requireScope(locals, 'rights:read');
	const [coverage, labels] = await Promise.all([
		locals.db((tx) => masterCoverage(tx, m.orgId)),
		locals.db((tx) => openMastersByLabel(tx, m.orgId))
	]);
	return { coverage, labels, canWrite: hasScope(m.role, 'rights:write') };
};

export const actions: Actions = {
	claim: async ({ request, locals }) => {
		const m = requireScope(locals, 'rights:write');
		const ctx = { orgId: m.orgId, actor: { id: locals.user!.id, kind: 'user' as const } };
		const f = await formFields(request);
		return editAction('claim', f, () =>
			locals.db((tx) => claimMastersForLabel(tx, ctx, f.labelId))
		);
	}
};
