import { describe, expect, it, vi } from 'vitest';
import { BillingError, LabelClientsBilling } from './billing';

const CLIENT = '0198a000-0000-7000-8000-000000000001';
const label = (sync = 'synced') => ({
	client_id: CLIENT,
	erms_org_id: 'org-1',
	status: 'active',
	unlimited: true,
	key_prefix: 'ak_example',
	sync_state: sync,
	synced_at: null
});
const credentials = { api_key: 'ak_never_logged', webhook_secret: 'whsec_never_logged' };

function billing(res: Response) {
	const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(res);
	return {
		b: new LabelClientsBilling('https://billing.example/', 'admin-token', fetchImpl),
		fetchImpl
	};
}

describe('billing label-client calls', () => {
	it('issues with the admin token, the org id and unlimited, and returns the credentials', async () => {
		const { b, fetchImpl } = billing(
			Response.json({ label_client: label(), credentials }, { status: 201 })
		);
		const issued = await b.issue('org-1');
		expect(issued.httpStatus).toBe(201);
		expect(issued.credentials).toEqual(credentials);
		const [url, init] = fetchImpl.mock.calls[0];
		expect(url).toBe('https://billing.example/v1/admin/label-clients');
		expect(init?.method).toBe('POST');
		expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer admin-token');
		expect(JSON.parse(init?.body as string)).toEqual({ erms_org_id: 'org-1', unlimited: true });
	});

	it('reports a 202 as not yet synced', async () => {
		const { b } = billing(
			Response.json({ label_client: label('pending_sync'), credentials }, { status: 202 })
		);
		const issued = await b.rotate('org-1');
		expect(issued.httpStatus).toBe(202);
		expect(issued.label_client.sync_state).toBe('pending_sync');
	});

	it('turns an error into its status and code only', async () => {
		const { b } = billing(
			Response.json(
				{ error: 'label_client_exists', message: 'echo ak_never_logged' },
				{ status: 409 }
			)
		);
		const err = await b.issue('org-1').catch((e) => e);
		expect(err).toBeInstanceOf(BillingError);
		expect(err).toMatchObject({ status: 409, code: 'label_client_exists' });
		expect(String(err)).not.toContain('ak_never_logged');
		expect(String(err)).not.toContain('admin-token');
	});

	it('rejects a 2xx that is not the contract, without echoing the body', async () => {
		const { b } = billing(Response.json({ credentials }, { status: 201 }));
		const err = await b.issue('org-1').catch((e) => e);
		expect(err).toMatchObject({ code: 'unexpected_response' });
		expect(String(err)).not.toContain('ak_never_logged');
	});

	it('reads and revokes a client by id', async () => {
		const get = billing(Response.json({ label_client: label('pending_sync') }));
		expect((await get.b.get(CLIENT)).sync_state).toBe('pending_sync');
		expect(get.fetchImpl.mock.calls[0][0]).toBe(
			`https://billing.example/v1/admin/label-clients/${CLIENT}`
		);
		const del = billing(Response.json({ label_client: label('pending_revoke') }));
		expect((await del.b.revoke(CLIENT)).sync_state).toBe('pending_revoke');
		expect(del.fetchImpl.mock.calls[0][1]?.method).toBe('DELETE');
	});

	it('gives every call a timeout so a stalled billing cannot hold a run', async () => {
		const { b, fetchImpl } = billing(Response.json({ label_client: label() }));
		await b.get(CLIENT);
		expect(fetchImpl.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
	});
});
