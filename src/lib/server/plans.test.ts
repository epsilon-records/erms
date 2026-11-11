import { describe, expect, it, vi } from 'vitest';
import { LabelPlansBilling, limitsFor, monthStart, PlansError, plansClient } from './plans.js';

const view = {
	label_plan: {
		erms_org_id: 'org-1',
		plan: 'free',
		status: null,
		current_period_end: null,
		cancel_at_period_end: false,
		limits: { tracks: 100, seats: 2, analysisJobsPerMonth: 25 }
	}
};
const respond = (status: number, body: unknown) =>
	vi.fn(async () => new Response(JSON.stringify(body), { status }));
const config = {
	enabled: true,
	billingUrl: 'https://billing.example',
	adminToken: 'admin-token',
	exemptOrgIds: ['org-epsilon']
};

describe('LabelPlansBilling', () => {
	it('reads the plan with the admin token', async () => {
		const fetchImpl = respond(200, view);
		const plan = await new LabelPlansBilling('https://billing.example/', 't', fetchImpl).plan(
			'org-1'
		);
		expect(plan.limits.seats).toBe(2);
		const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('https://billing.example/v1/admin/labels/org-1/plan');
		expect((init.headers as Record<string, string>).Authorization).toBe('Bearer t');
	});

	it("passes billing's error code through", async () => {
		const client = new LabelPlansBilling(
			'https://b',
			't',
			respond(409, { error: 'already_subscribed' })
		);
		await expect(
			client.checkout('org-1', {
				interval: 'month',
				labelName: 'L',
				successUrl: 'https://labelkit.co/org/billing',
				cancelUrl: 'https://labelkit.co/org/billing'
			})
		).rejects.toMatchObject({ status: 409, code: 'already_subscribed' });
	});

	it('refuses a response that is not a plan', async () => {
		const client = new LabelPlansBilling('https://b', 't', respond(200, { nope: true }));
		await expect(client.plan('org-1')).rejects.toBeInstanceOf(PlansError);
	});
});

describe('limitsFor', () => {
	it('applies no limits when plans are off', async () => {
		expect(plansClient({ ...config, enabled: false })).toBeNull();
		expect(await limitsFor({ ...config, enabled: false }, 'org-1')).toBeNull();
	});

	it('applies no limits to an exempt org', async () => {
		const client = new LabelPlansBilling('https://b', 't', respond(200, view));
		expect(await limitsFor(config, 'org-epsilon', client)).toBeNull();
	});

	it('fails open when billing is unreachable', async () => {
		const client = new LabelPlansBilling(
			'https://b',
			't',
			vi.fn(async () => {
				throw new Error('down');
			})
		);
		vi.spyOn(console, 'error').mockImplementation(() => {});
		expect(await limitsFor(config, 'org-1', client)).toBeNull();
	});

	it("returns the plan's limits otherwise", async () => {
		const client = new LabelPlansBilling('https://b', 't', respond(200, view));
		expect(await limitsFor(config, 'org-1', client)).toEqual(view.label_plan.limits);
	});
});

it('counts analyses from the 1st of the month, UTC', () => {
	expect(monthStart(new Date('2026-11-30T23:30:00Z')).toISOString()).toBe(
		'2026-11-01T00:00:00.000Z'
	);
});
