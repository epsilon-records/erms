import { describe, expect, it } from 'vitest';
import {
	DomainError,
	hasVerificationRecord,
	isApex,
	parseDomain,
	provisioner,
	txtName,
	txtValue
} from './custom-domain';

describe('parseDomain', () => {
	it('normalises what an owner is likely to paste', () => {
		expect(parseDomain(' https://ERMS.Example.com/login ')).toBe('erms.example.com');
		expect(parseDomain('catalogue.yourlabel.com.')).toBe('catalogue.yourlabel.com');
		expect(parseDomain('yourlabel.com')).toBe('yourlabel.com');
	});

	it('refuses things that are not hostnames', () => {
		for (const bad of [
			'',
			'localhost',
			'not a domain',
			'a_b.example.com',
			'-x.example.com',
			'1.2.3.4'
		]) {
			expect(() => parseDomain(bad), bad).toThrow(DomainError);
		}
	});

	it("refuses LabelKit's own hosts", () => {
		for (const bad of ['labelkit.co', 'api.labelkit.co', 'labelkit.netlify.app', 'x.supabase.co']) {
			expect(() => parseDomain(bad), bad).toThrow(/belongs to LabelKit/);
		}
	});

	it('tells an apex domain from a subdomain', () => {
		expect(isApex('yourlabel.com')).toBe(true);
		expect(isApex('catalogue.yourlabel.com')).toBe(false);
		// A multi-part public suffix is not the label's name: yourlabel.co.uk is still the apex.
		expect(isApex('yourlabel.co.uk')).toBe(true);
		expect(isApex('catalogue.yourlabel.co.uk')).toBe(false);
	});
});

describe('hasVerificationRecord', () => {
	const token = 'abc123';
	const records = (r: string[][]) => async (name: string) => {
		expect(name).toBe(txtName('erms.example.com'));
		return r;
	};

	it('finds the token, even split over TXT chunks and among other records', async () => {
		expect(
			await hasVerificationRecord(
				'erms.example.com',
				token,
				records([['v=spf1 -all'], ['labelkit-verify=', 'abc123']])
			)
		).toBe(true);
	});

	it('is false for a wrong value or a missing record', async () => {
		expect(
			await hasVerificationRecord('erms.example.com', token, records([['labelkit-verify=nope']]))
		).toBe(false);
		const missing = async () => {
			throw Object.assign(new Error('nx'), { code: 'ENOTFOUND' });
		};
		expect(await hasVerificationRecord('erms.example.com', token, missing)).toBe(false);
	});

	it('the record value names LabelKit', () => {
		expect(txtValue(token)).toBe('labelkit-verify=abc123');
	});
});

describe('provisioner', () => {
	function fakeApis(state: { aliases: string[]; allow: string }) {
		const calls: Array<{ method: string; url: string; body?: unknown }> = [];
		const fakeFetch = (async (url: string, init?: RequestInit) => {
			const method = init?.method ?? 'GET';
			const body = init?.body ? JSON.parse(String(init.body)) : undefined;
			calls.push({ method, url, body });
			expect((init?.headers as Record<string, string>).authorization).toMatch(/^Bearer /);
			if (new URL(url).host === 'api.netlify.com') {
				if (method === 'PATCH') state.aliases = body.domain_aliases;
				return Response.json({ domain_aliases: state.aliases, other: 'kept' });
			}
			if (method === 'PATCH') state.allow = body.uri_allow_list;
			return Response.json({ uri_allow_list: state.allow, smtp_pass: 'secret' });
		}) as typeof globalThis.fetch;
		return { fetch: fakeFetch, calls };
	}
	const config = {
		netlifyToken: 'n',
		netlifySiteId: 'site',
		supabaseToken: 's',
		supabaseProjectRef: 'ref'
	};

	it('adds the alias and the callback, keeping what is there, and only PATCHes what changes', async () => {
		const state = { aliases: ['erms.example.com'], allow: 'https://labelkit.co/auth/callback' };
		const { fetch, calls } = fakeApis(state);
		await provisioner({ ...config, fetch }).add('new.example.com');
		expect(state.aliases).toEqual(['erms.example.com', 'new.example.com']);
		expect(state.allow).toBe(
			'https://labelkit.co/auth/callback,https://new.example.com/auth/callback'
		);
		// The PATCH bodies carry only the list they change: nothing else of the config.
		for (const c of calls.filter((c) => c.method === 'PATCH')) {
			expect(Object.keys(c.body as object)).toHaveLength(1);
		}
		calls.length = 0;
		await provisioner({ ...config, fetch }).add('new.example.com');
		expect(calls.filter((c) => c.method === 'PATCH')).toEqual([]);
	});

	it('removes only that domain', async () => {
		const state = {
			aliases: ['erms.example.com', 'new.example.com'],
			allow: 'https://labelkit.co/auth/callback,https://new.example.com/auth/callback'
		};
		const { fetch } = fakeApis(state);
		await provisioner({ ...config, fetch }).remove('new.example.com');
		expect(state.aliases).toEqual(['erms.example.com']);
		expect(state.allow).toBe('https://labelkit.co/auth/callback');
	});

	it('without its tokens it refuses to add, says which are missing, and removes nothing', async () => {
		const p = provisioner({ netlifySiteId: 'site' });
		expect(p.configured).toBe(false);
		await expect(p.add('x.example.com')).rejects.toThrow(
			/NETLIFY_API_TOKEN, SUPABASE_ACCESS_TOKEN/
		);
		await expect(p.remove('x.example.com')).resolves.toBeUndefined();
	});

	it('reports an unreachable API as a 502, not a crash', async () => {
		const fetch = (async () => {
			throw new TypeError('fetch failed');
		}) as unknown as typeof globalThis.fetch;
		await expect(provisioner({ ...config, fetch }).remove('x.example.com')).rejects.toMatchObject({
			status: 502,
			message: 'api.netlify.com did not answer.'
		});
	});

	it('reports an API failure as a 502', async () => {
		const fetch = (async () =>
			new Response('no', { status: 401 })) as unknown as typeof globalThis.fetch;
		await expect(provisioner({ ...config, fetch }).add('x.example.com')).rejects.toMatchObject({
			status: 502
		});
	});
});
