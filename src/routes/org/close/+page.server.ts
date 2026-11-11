import { fail, redirect } from '@sveltejs/kit';
import { requireScope } from '#lib/server/guard.js';
import { plansClient } from '#lib/server/plans.js';
import { plansConfig } from '#lib/server/plans-env.js';
import { closeOrg, PurgeError } from '#lib/server/purge.js';
import type { Actions, PageServerLoad } from './$types';

/** Close the label, for its owners: it stops working now and is deleted 30 days later. */
async function paidAndRenewing(orgId: string) {
	const billing = plansClient(plansConfig());
	if (!billing) return false;
	const plan = await billing.plan(orgId).catch(() => null);
	return Boolean(plan && plan.plan === 'label' && !plan.cancel_at_period_end);
}

export const load: PageServerLoad = async ({ locals }) => {
	const m = requireScope(locals, 'roles:manage');
	return { orgName: m.orgName, renewing: await paidAndRenewing(m.orgId) };
};

export const actions: Actions = {
	default: async ({ request, locals }) => {
		const m = requireScope(locals, 'roles:manage');
		const typed = String((await request.formData()).get('confirm') ?? '').trim();
		if (typed !== m.orgName) {
			return fail(400, { error: `Type the label's name, ${m.orgName}, to confirm.` });
		}
		if (await paidAndRenewing(m.orgId)) {
			return fail(409, {
				error: 'Cancel the Label plan on the Billing page first, so you are not charged again.'
			});
		}
		try {
			await locals.db((tx) => closeOrg(tx, m.orgId));
		} catch (e) {
			if (e instanceof PurgeError) return fail(e.status, { error: e.message });
			throw e;
		}
		redirect(303, '/org/closed');
	}
};
