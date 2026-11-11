import { and, count, eq, gte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '#lib/server/audit.js';
import { audiokitJobs, memberships, recordings } from '#lib/server/db/schema.js';

/**
 * LabelKit plans (EPSILON-136). epsilon-billing owns each label's plan and its Stripe
 * subscription. LabelKit reads the plan and its limits from billing's admin routes
 * (/v1/admin/labels/:org/...) with LABEL_CLIENTS_ADMIN_TOKEN, and enforces the limits here.
 *
 * Limits fail open. If plans are off, the org is exempt, or billing can't be reached, no
 * limit applies, so a billing outage never blocks a label's work.
 */

const Limits = z.object({
	tracks: z.number().int().nonnegative(),
	seats: z.number().int().nonnegative(),
	analysisJobsPerMonth: z.number().int().nonnegative()
});
const PlanView = z.object({
	plan: z.enum(['free', 'label']),
	status: z.string().nullable(),
	current_period_end: z.string().nullable(),
	cancel_at_period_end: z.boolean(),
	limits: Limits
});
export type LabelPlan = z.infer<typeof PlanView>;
export type PlanLimits = z.infer<typeof Limits>;

export class PlansError extends Error {
	constructor(
		readonly status: number,
		readonly code: string
	) {
		super(`billing answered ${status} ${code}`);
	}
}

export class LabelPlansBilling {
	constructor(
		private readonly baseUrl: string,
		private readonly adminToken: string,
		private readonly fetchImpl: typeof fetch = fetch,
		private readonly timeoutMs = 5_000
	) {
		if (!baseUrl || !adminToken) throw new Error('billing base URL and admin token are required');
	}

	private async call(method: string, path: string, body?: unknown): Promise<unknown> {
		const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}/v1/admin/labels${path}`, {
			method,
			headers: { Authorization: `Bearer ${this.adminToken}`, 'Content-Type': 'application/json' },
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: AbortSignal.timeout(this.timeoutMs)
		});
		const text = await res.text();
		let data: unknown = null;
		try {
			data = text ? JSON.parse(text) : null;
		} catch {
			/* treated as an error below */
		}
		if (!res.ok) {
			const code = (data as { error?: unknown } | null)?.error;
			throw new PlansError(res.status, typeof code === 'string' ? code : 'unknown');
		}
		return data;
	}

	async plan(orgId: string): Promise<LabelPlan> {
		const data = await this.call('GET', `/${encodeURIComponent(orgId)}/plan`);
		const parsed = z.object({ label_plan: PlanView }).safeParse(data);
		if (!parsed.success) throw new PlansError(502, 'unexpected_response');
		return parsed.data.label_plan;
	}

	async checkout(
		orgId: string,
		input: { interval: 'month' | 'year'; labelName: string; successUrl: string; cancelUrl: string }
	): Promise<string> {
		const data = await this.call('POST', `/${encodeURIComponent(orgId)}/checkout`, {
			interval: input.interval,
			label_name: input.labelName,
			success_url: input.successUrl,
			cancel_url: input.cancelUrl
		});
		const parsed = z.object({ checkout: z.object({ url: z.url() }) }).safeParse(data);
		if (!parsed.success) throw new PlansError(502, 'unexpected_response');
		return parsed.data.checkout.url;
	}

	async portal(orgId: string, returnUrl: string): Promise<string> {
		const data = await this.call('POST', `/${encodeURIComponent(orgId)}/portal`, {
			return_url: returnUrl
		});
		const parsed = z.object({ portal: z.object({ url: z.url() }) }).safeParse(data);
		if (!parsed.success) throw new PlansError(502, 'unexpected_response');
		return parsed.data.portal.url;
	}
}

export type PlansConfig = {
	enabled: boolean;
	billingUrl: string | undefined;
	adminToken: string | undefined;
	exemptOrgIds: readonly string[];
};

export function plansClient(config: PlansConfig): LabelPlansBilling | null {
	if (!config.enabled || !config.billingUrl || !config.adminToken) return null;
	return new LabelPlansBilling(config.billingUrl, config.adminToken);
}

/** The limits that apply to an org right now, or null when none do (see the module note). */
export async function limitsFor(
	config: PlansConfig,
	orgId: string,
	client: LabelPlansBilling | null = plansClient(config)
): Promise<PlanLimits | null> {
	if (!client || config.exemptOrgIds.includes(orgId)) return null;
	try {
		return (await client.plan(orgId)).limits;
	} catch (e) {
		console.error(
			JSON.stringify({ level: 'warn', msg: 'plan lookup failed; limits not applied', e: String(e) })
		);
		return null;
	}
}

export type Usage = { tracks: number; seats: number; analysisJobsThisMonth: number };

/**
 * Start of the current calendar month, UTC: analysis limits reset on the 1st. Every AudioKit job
 * counts (analysis, preview, transcode alike), because each one is a job run on AudioKit.
 */
export function monthStart(now = new Date()): Date {
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Serialize a count-then-write limit check per org and limit: two concurrent requests for the same
 * label would otherwise both pass a check at limit - 1. Transaction-scoped, so it is held through
 * the write and released at commit or rollback.
 */
export async function lockLimit(
	tx: Database,
	orgId: string,
	limit: 'tracks' | 'analysis'
): Promise<void> {
	await tx.execute(
		sql`select pg_advisory_xact_lock(hashtextextended(${`plan-limit:${limit}:${orgId}`}, 0))`
	);
}

export async function countRecordings(tx: Database, orgId: string): Promise<number> {
	const [row] = await tx.select({ n: count() }).from(recordings).where(eq(recordings.orgId, orgId));
	return row.n;
}

export async function countMembers(tx: Database, orgId: string): Promise<number> {
	const [row] = await tx
		.select({ n: count() })
		.from(memberships)
		.where(eq(memberships.orgId, orgId));
	return row.n;
}

export async function countAnalysesThisMonth(
	tx: Database,
	orgId: string,
	now = new Date()
): Promise<number> {
	const [row] = await tx
		.select({ n: count() })
		.from(audiokitJobs)
		.where(and(eq(audiokitJobs.orgId, orgId), gte(audiokitJobs.requestedAt, monthStart(now))));
	return row.n;
}

export async function usageFor(tx: Database, orgId: string, now = new Date()): Promise<Usage> {
	const [tracks, seats, analysisJobsThisMonth] = await Promise.all([
		countRecordings(tx, orgId),
		countMembers(tx, orgId),
		countAnalysesThisMonth(tx, orgId, now)
	]);
	return { tracks, seats, analysisJobsThisMonth };
}

export const LIMIT_MESSAGES = {
	tracks: (limit: number) =>
		`Your plan allows ${limit} recordings. Upgrade the label's plan on the Billing page to add more.`,
	seats: (limit: number) =>
		`Your plan allows ${limit} members. Upgrade the label's plan on the Billing page to invite more.`,
	analysis: (limit: number) =>
		`Your plan allows ${limit} AudioKit jobs a month. Upgrade the label's plan on the Billing page, or wait until the 1st.`
};
