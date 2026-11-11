import { describe, expect, it, vi } from 'vitest';
import { handleSendEmailHook, type HookConfig } from './hook';
import { hookKey, signHook } from './signature';
import { randomHookSecret } from './test-secrets';

const SECRET = randomHookSecret();
const EPSILON = '019a0000-0000-7000-8000-00000000e951';
const OTHER = '019a0000-0000-7000-8000-0000000000b2';
const USER = '6f1c2b8e-1c1a-4d55-9a57-0b1f1b0a5c11';
const NOW = 1_794_400_000_000;

function payload(type = 'magiclink', metadata: Record<string, unknown> = {}) {
	return JSON.stringify({
		user: {
			id: USER,
			aud: 'authenticated',
			role: 'authenticated',
			email: 'staff@example.test',
			phone: '',
			app_metadata: {},
			user_metadata: metadata,
			identities: [],
			created_at: '2026-11-11T00:00:00Z',
			updated_at: '2026-11-11T00:00:00Z',
			is_anonymous: false
		},
		email_data: {
			token: '123456',
			token_hash: 'pkce_abcdef0123456789',
			redirect_to: 'https://labelkit.co/auth/callback',
			email_action_type: type,
			site_url: 'https://efalpthvvmvpaikuxymd.supabase.co/auth/v1',
			token_new: '',
			token_hash_new: ''
		}
	});
}

function signed(body: string, opts: { secret?: string; id?: string; at?: number } = {}) {
	const id = opts.id ?? 'msg_1';
	const ts = Math.floor((opts.at ?? NOW) / 1000);
	const sig = signHook(hookKey(opts.secret ?? SECRET)!, id, ts, body);
	return new Request('https://labelkit.co/api/auth/send-email', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'webhook-id': id,
			'webhook-timestamp': String(ts),
			'webhook-signature': `v1,${sig}`
		},
		body
	});
}

const CONFIG: HookConfig = {
	hookSecret: SECRET,
	keys: { epsilon: 'fake-key-epsilon', labelkit: 'fake-key-labelkit' },
	epsilonOrgId: EPSILON,
	supabaseUrl: 'https://efalpthvvmvpaikuxymd.supabase.co'
};

function setup(
	orgs: string[] | Error = [],
	config: Partial<HookConfig> = {},
	resend?: () => Response
) {
	const fetcher = vi.fn(async () => resend?.() ?? Response.json({ id: 'email_1' }));
	const memberOrgIds = vi.fn(async () => {
		if (orgs instanceof Error) throw orgs;
		return orgs;
	});
	const logs: Record<string, unknown>[] = [];
	const run = (req: Request) =>
		handleSendEmailHook(req, {
			config: { ...CONFIG, ...config },
			appOrigin: 'https://labelkit.co',
			memberOrgIds,
			fetcher: fetcher as unknown as typeof fetch,
			now: () => NOW,
			log: (l) => logs.push(l)
		});
	const sent = () =>
		fetcher.mock.calls.map((call) => {
			const [, init] = call as unknown as [string, RequestInit];
			const headers = init.headers as Record<string, string>;
			return {
				auth: headers.authorization,
				idem: headers['idempotency-key'],
				body: JSON.parse(init.body as string)
			};
		});
	return { run, fetcher, memberOrgIds, logs, sent };
}

describe('Send Email hook', () => {
	it('Epsilon staff: sends from auth.epsilonrecords.com with the Epsilon key', async () => {
		const t = setup([EPSILON]);
		const res = await t.run(signed(payload()));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({});
		expect(t.memberOrgIds).toHaveBeenCalledWith(USER);
		const [mail] = t.sent();
		expect(mail.auth).toBe('Bearer fake-key-epsilon');
		expect(mail.body.from).toBe('Epsilon Records <no-reply@auth.epsilonrecords.com>');
		expect(mail.body.to).toEqual(['staff@example.test']);
		expect(mail.idem).toBe('msg_1:0');
	});

	it('another label’s member: sends from auth.labelkit.co with the LabelKit key', async () => {
		const t = setup([OTHER]);
		expect((await t.run(signed(payload()))).status).toBe(200);
		const [mail] = t.sent();
		expect(mail.auth).toBe('Bearer fake-key-labelkit');
		expect(mail.body.from).toBe('LabelKit <no-reply@auth.labelkit.co>');
	});

	it('an invite to Epsilon for a new address sends from auth.epsilonrecords.com', async () => {
		const t = setup([]);
		const body = payload('invite', {
			invited_org_name: 'Epsilon Records',
			invited_org_id: EPSILON
		});
		expect((await t.run(signed(body))).status).toBe(200);
		const [mail] = t.sent();
		expect(mail.body.from).toContain('auth.epsilonrecords.com');
		expect(mail.body.subject).toBe("You're invited to Epsilon Records on ERMS");
		expect(mail.body.html).toContain(
			'https://labelkit.co/auth/confirm?token_hash=pkce_abcdef0123456789'
		);
	});

	it('Epsilon and another org: a sign-in link comes from auth.labelkit.co', async () => {
		const t = setup([EPSILON, OTHER]);
		await t.run(signed(payload()));
		expect(t.sent()[0].body.from).toContain('auth.labelkit.co');
	});

	it('rejects a bad signature before any lookup or send', async () => {
		const t = setup([EPSILON]);
		const other = randomHookSecret();
		const res = await t.run(signed(payload(), { secret: other }));
		expect(res.status).toBe(401);
		expect(await res.json()).toMatchObject({ error: { http_code: 401 } });
		expect(t.memberOrgIds).not.toHaveBeenCalled();
		expect(t.fetcher).not.toHaveBeenCalled();
	});

	it('rejects a replay older than five minutes', async () => {
		const t = setup([EPSILON]);
		const res = await t.run(signed(payload(), { at: NOW - 301_000 }));
		expect(res.status).toBe(401);
		expect(t.fetcher).not.toHaveBeenCalled();
	});

	it('rejects a body changed after signing', async () => {
		const t = setup([EPSILON]);
		const req = signed(payload());
		const tampered = new Request(req.url, {
			method: 'POST',
			headers: req.headers,
			body: payload('magiclink').replace('staff@example.test', 'attacker@example.test')
		});
		expect((await t.run(tampered)).status).toBe(401);
		expect(t.fetcher).not.toHaveBeenCalled();
	});

	it('fails closed without the hook secret', async () => {
		const t = setup([EPSILON], { hookSecret: undefined });
		const res = await t.run(signed(payload()));
		expect(res.status).toBe(500);
		expect(t.fetcher).not.toHaveBeenCalled();
	});

	it('fails closed without the chosen sender’s key: never falls back to the other domain', async () => {
		const t = setup([EPSILON], { keys: { epsilon: undefined, labelkit: 'fake-key-labelkit' } });
		const res = await t.run(signed(payload()));
		expect(res.status).toBe(500);
		expect((await res.json()).error.message).toContain('auth.epsilonrecords.com');
		expect(t.fetcher).not.toHaveBeenCalled();
	});

	it('fails closed without Epsilon’s org id, rather than sending staff LabelKit mail', async () => {
		const t = setup([EPSILON], { epsilonOrgId: undefined });
		expect((await t.run(signed(payload()))).status).toBe(500);
		expect(t.fetcher).not.toHaveBeenCalled();
	});

	it('fails closed when the membership lookup fails', async () => {
		const t = setup(new Error('db down'));
		expect((await t.run(signed(payload()))).status).toBe(500);
		expect(t.fetcher).not.toHaveBeenCalled();
	});

	it('fails closed when Resend refuses, and passes a rate limit through as 429', async () => {
		const t = setup([OTHER], {}, () =>
			Response.json({ name: 'rate_limit_exceeded' }, { status: 429 })
		);
		const res = await t.run(signed(payload()));
		expect(res.status).toBe(502);
		expect((await res.json()).error.http_code).toBe(429);
		expect(t.fetcher).toHaveBeenCalledTimes(1);
		const failed = setup([OTHER], {}, () =>
			Response.json({ name: 'validation_error' }, { status: 422 })
		);
		const res2 = await failed.run(signed(payload()));
		expect(res2.status).toBe(502);
		expect((await res2.json()).error.http_code).toBe(500);
		expect(failed.fetcher).toHaveBeenCalledTimes(1);
	});

	it('fails closed on an unknown email type', async () => {
		const t = setup([OTHER]);
		expect((await t.run(signed(payload('brand_new_type')))).status).toBe(500);
		expect(t.fetcher).not.toHaveBeenCalled();
	});

	it('rejects a malformed payload even when correctly signed', async () => {
		const t = setup([OTHER]);
		expect((await t.run(signed('{"user":{}}'))).status).toBe(400);
		expect(t.fetcher).not.toHaveBeenCalled();
	});

	it('never logs the address or the token', async () => {
		const t = setup([OTHER]);
		await t.run(signed(payload()));
		const out = JSON.stringify(t.logs);
		expect(out).not.toContain('staff@example.test');
		expect(out).not.toContain('pkce_abcdef0123456789');
		expect(out).not.toContain('123456"');
		expect(t.logs.at(-1)).toMatchObject({ outcome: 'sent', sender: 'auth.labelkit.co' });
	});
});
