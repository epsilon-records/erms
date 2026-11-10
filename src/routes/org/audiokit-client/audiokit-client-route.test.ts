import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	issue: vi.fn(async () => ({ clientId: 'c1', status: 'active' })),
	rotate: vi.fn(async () => ({ clientId: 'c2', status: 'active' })),
	env: {
		AUDIOKIT_BILLING_URL: 'https://billing.example',
		AUDIOKIT_CREDENTIALS_KEY: `k1:${Buffer.alloc(32, 3).toString('base64')}`,
		LABEL_CLIENTS_ADMIN_TOKEN: 'admin-token' as string | undefined
	}
}));
vi.mock('$app/env/private', () => mocks.env);
vi.mock('#lib/server/db/client.js', () => ({ db: () => ({}) }));
vi.mock('#lib/server/audiokit-clients.js', async (orig) => ({
	...(await orig<typeof import('#lib/server/audiokit-clients.js')>()),
	issueLabelClient: mocks.issue,
	rotateLabelClient: mocks.rotate
}));

import { POST } from './+server.js';

const ORG = 'a0000000-0000-4000-8000-00000000000a';
const OTHER_ORG = 'b0000000-0000-4000-8000-00000000000b';

function call(role: 'owner' | 'viewer' | null, fields: Record<string, string>) {
	const body = new URLSearchParams(fields);
	return POST({
		request: new Request('https://erms.test/org/audiokit-client', { method: 'POST', body }),
		locals: {
			user: { id: 'u1' },
			membership: role ? { orgId: ORG, orgName: 'Invented', role } : null
		}
	} as never);
}

describe('POST /org/audiokit-client', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.env.LABEL_CLIENTS_ADMIN_TOKEN = 'admin-token';
	});

	it('is for owners only', async () => {
		await expect(call('viewer', { action: 'issue' })).rejects.toMatchObject({ status: 403 });
		await expect(call(null, { action: 'issue' })).rejects.toMatchObject({ status: 403 });
		expect(mocks.issue).not.toHaveBeenCalled();
	});

	it("acts in the member's own org, whatever the form says", async () => {
		const res = await call('owner', { action: 'issue', orgId: OTHER_ORG, org_id: OTHER_ORG });
		expect(res.status).toBe(201);
		expect(mocks.issue).toHaveBeenCalledTimes(1);
		const admin = (mocks.issue.mock.calls[0] as unknown[])[3];
		expect(admin).toMatchObject({ orgId: ORG, actor: { id: 'u1', kind: 'user' } });
		// The response names the client, never a key or a secret.
		expect(Object.keys(await res.json()).sort()).toEqual(['clientId', 'status']);
	});

	it('rotates on request and rejects any other action', async () => {
		await call('owner', { action: 'rotate' });
		expect(mocks.rotate).toHaveBeenCalledTimes(1);
		await expect(call('owner', { action: 'revoke' })).rejects.toMatchObject({ status: 400 });
	});

	it('answers 503 until billing and the credentials key are configured', async () => {
		mocks.env.LABEL_CLIENTS_ADMIN_TOKEN = undefined;
		await expect(call('owner', { action: 'issue' })).rejects.toMatchObject({ status: 503 });
		expect(mocks.issue).not.toHaveBeenCalled();
	});
});
