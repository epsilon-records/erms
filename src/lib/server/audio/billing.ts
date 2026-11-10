import { z } from 'zod';

/**
 * Client for billing's label-client admin routes (knowledge#69, audiokit-billing#34). ERMS calls
 * them server-side with LABEL_CLIENTS_ADMIN_TOKEN, to issue, rotate, read and revoke the AudioKit
 * client each label (org) uses. Billing treats `erms_org_id` as opaque; ERMS sends `orgs.id`.
 *
 * Issue and rotate return the key and webhook secret once. They are handed to the caller and not
 * kept here, logged, or put in an error. An error carries billing's status and error code only.
 */

export type SyncState = 'pending_sync' | 'synced' | 'pending_revoke' | 'revoked';

const LabelClient = z.object({
	client_id: z.uuid(),
	erms_org_id: z.string(),
	status: z.string(),
	unlimited: z.boolean().optional(),
	key_prefix: z.string().nullable().optional(),
	sync_state: z.enum(['pending_sync', 'synced', 'pending_revoke', 'revoked'])
});
export type BillingLabelClient = z.infer<typeof LabelClient>;

const Issued = z.object({
	label_client: LabelClient,
	credentials: z.object({ api_key: z.string().min(1), webhook_secret: z.string().min(1) })
});
export type IssuedClient = z.infer<typeof Issued> & { httpStatus: 201 | 202 };

export class BillingError extends Error {
	constructor(
		readonly status: number,
		readonly code: string
	) {
		super(`billing answered ${status} ${code}`);
	}
}

export class LabelClientsBilling {
	constructor(
		private readonly baseUrl: string,
		private readonly adminToken: string,
		private readonly fetchImpl: typeof fetch = fetch
	) {
		if (!baseUrl || !adminToken) throw new Error('billing base URL and admin token are required');
	}

	private async call(method: string, path: string, body?: unknown) {
		const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
			method,
			headers: {
				Authorization: `Bearer ${this.adminToken}`,
				'Content-Type': 'application/json'
			},
			body: body === undefined ? undefined : JSON.stringify(body)
		});
		const text = await res.text();
		let data: unknown = null;
		try {
			data = text ? JSON.parse(text) : null;
		} catch {
			/* a non-JSON body is treated as an error below */
		}
		if (!res.ok) {
			const code = (data as { error?: unknown } | null)?.error;
			throw new BillingError(res.status, typeof code === 'string' ? code : 'unknown');
		}
		return { status: res.status, data };
	}

	private async issueLike(path: string, orgId: string, extra: object): Promise<IssuedClient> {
		const { status, data } = await this.call('POST', path, { erms_org_id: orgId, ...extra });
		const parsed = Issued.safeParse(data);
		if (!parsed.success || (status !== 201 && status !== 202)) {
			throw new BillingError(status, 'unexpected_response');
		}
		return { ...parsed.data, httpStatus: status };
	}

	/** First client for an org. 409 `label_client_exists` means rotate instead. */
	issue(orgId: string) {
		return this.issueLike('/v1/admin/label-clients', orgId, { unlimited: true });
	}

	/** A second client alongside the active one. The new client inherits `unlimited`. */
	rotate(orgId: string) {
		return this.issueLike('/v1/admin/label-clients/rotate', orgId, {});
	}

	async get(clientId: string): Promise<BillingLabelClient> {
		const { data } = await this.call('GET', `/v1/admin/label-clients/${clientId}`);
		const parsed = z.object({ label_client: LabelClient }).safeParse(data);
		if (!parsed.success) throw new BillingError(200, 'unexpected_response');
		return parsed.data.label_client;
	}

	/** Final. Idempotent. `sync_state` reads `pending_revoke` until the API has confirmed. */
	async revoke(clientId: string): Promise<BillingLabelClient> {
		const { data } = await this.call('DELETE', `/v1/admin/label-clients/${clientId}`);
		const parsed = z.object({ label_client: LabelClient }).safeParse(data);
		if (!parsed.success) throw new BillingError(200, 'unexpected_response');
		return parsed.data.label_client;
	}
}
