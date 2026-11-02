import { editAction, formFields } from '#lib/server/form.js';
import { requireScope } from '#lib/server/guard.js';
import { hasScope } from '#lib/server/rbac.js';
import {
	grantConsent,
	holderOptions,
	listAgreements,
	listConsents,
	revokeConsent
} from '#lib/server/rights.js';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const m = requireScope(locals, 'rights:read');
	const canWrite = hasScope(m.role, 'consent:write');
	const [consents, options, agreements] = await Promise.all([
		locals.db((tx) => listConsents(tx, m.orgId)),
		canWrite ? locals.db((tx) => holderOptions(tx, m.orgId)) : null,
		canWrite ? locals.db((tx) => listAgreements(tx, m.orgId)) : null
	]);
	return { consents, options, agreements, today: new Date().toISOString().slice(0, 10) };
};

const ctxFor = (locals: App.Locals) => {
	const m = requireScope(locals, 'consent:write');
	return { orgId: m.orgId, actor: { id: locals.user!.id, kind: 'user' as const } };
};

export const actions: Actions = {
	grant: async ({ request, locals }) => {
		const ctx = ctxFor(locals);
		const f = await formFields(request);
		return editAction('grant', f, () => locals.db((tx) => grantConsent(tx, ctx, f)));
	},
	revoke: async ({ request, locals }) => {
		const ctx = ctxFor(locals);
		const f = await formFields(request);
		return editAction('revoke', f, () => locals.db((tx) => revokeConsent(tx, ctx, f.consentId)));
	}
};
