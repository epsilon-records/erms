import { error, fail, redirect } from '@sveltejs/kit';
import { requireScope } from '#lib/server/guard.js';
import { plansClient, PlansError, usageFor } from '#lib/server/plans.js';
import { plansConfig } from '#lib/server/plans-env.js';
import type { Actions, PageServerLoad } from './$types';

/**
 * The label's plan and billing (EPSILON-136), for its owners. The plan lives in epsilon-billing;
 * Checkout and the customer portal are Stripe pages that return here.
 */
function client() {
	const c = plansClient(plansConfig());
	if (!c) error(404, 'Billing is not enabled on this deployment.');
	return c;
}

export const load: PageServerLoad = async ({ locals, url }) => {
	const m = requireScope(locals, 'roles:manage');
	const billing = client();
	const exempt = plansConfig().exemptOrgIds.includes(m.orgId);
	const [plan, usage] = await Promise.all([
		billing.plan(m.orgId).catch((e) => {
			console.error(JSON.stringify({ level: 'warn', msg: 'plan lookup failed', e: String(e) }));
			return null;
		}),
		locals.db((tx) => usageFor(tx, m.orgId))
	]);
	return {
		orgName: m.orgName,
		plan,
		usage,
		exempt,
		checkoutDone: url.searchParams.has('checkout')
	};
};

const returnTo = (url: URL, query = '') => `${url.origin}/org/billing${query}`;

function billingFail(e: unknown) {
	if (e instanceof PlansError) {
		const message =
			e.code === 'already_subscribed'
				? 'This label already has the Label plan. Use Manage billing to change it.'
				: e.code === 'no_customer'
					? 'This label has no billing account yet.'
					: e.code === 'not_configured'
						? 'Paid plans are not set up yet.'
						: 'Billing is unavailable right now. Try again in a minute.';
		return fail(e.status >= 500 ? 503 : 400, { error: message });
	}
	// A timeout or a refused connection to billing: fetch rejects with these, not a PlansError.
	if (
		e instanceof Error &&
		(e.name === 'TimeoutError' || e.name === 'AbortError' || e instanceof TypeError)
	) {
		console.error(JSON.stringify({ level: 'warn', msg: 'billing unreachable', e: String(e) }));
		return fail(503, { error: 'Billing is unavailable right now. Try again in a minute.' });
	}
	throw e;
}

export const actions: Actions = {
	upgrade: async ({ request, locals, url }) => {
		const m = requireScope(locals, 'roles:manage');
		const interval = (await request.formData()).get('interval') === 'year' ? 'year' : 'month';
		let target: string;
		try {
			target = await client().checkout(m.orgId, {
				interval,
				labelName: m.orgName,
				successUrl: returnTo(url, '?checkout=done'),
				cancelUrl: returnTo(url)
			});
		} catch (e) {
			return billingFail(e);
		}
		redirect(303, target);
	},
	manage: async ({ locals, url }) => {
		const m = requireScope(locals, 'roles:manage');
		let target: string;
		try {
			target = await client().portal(m.orgId, returnTo(url));
		} catch (e) {
			return billingFail(e);
		}
		redirect(303, target);
	}
};
