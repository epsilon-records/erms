import { describe, expect, it } from 'vitest';
import {
	storybookGate,
	passwordMatches
} from '../../../storybook-site/netlify/edge-functions/storybook.mjs';

const basic = (user: string, pass: string) => `Basic ${btoa(`${user}:${pass}`)}`;
const next = async () =>
	new Response('<html>storybook</html>', { headers: { 'x-frame-options': 'DENY' } });

describe('storybook gate', () => {
	it('fails closed without a configured password', async () => {
		const res = (await storybookGate(() => undefined)(
			new Request('https://storybook.labelkit.co/', { headers: { authorization: basic('a', '') } }),
			{ next }
		)) as Response;
		expect(res.status).toBe(503);
	});

	it('asks for the password when it is missing or wrong', async () => {
		const gate = storybookGate(() => 'storybook');
		for (const authorization of [undefined, basic('x', 'nope'), 'Basic !!!', 'Bearer storybook']) {
			const headers = authorization ? { authorization } : undefined;
			const res = (await gate(new Request('https://storybook.labelkit.co/', { headers }), {
				next
			})) as Response;
			expect(res.status).toBe(401);
			expect(res.headers.get('www-authenticate')).toContain('Basic');
		}
	});

	it('serves the build with frame, robots and cache headers set', async () => {
		const gate = storybookGate(() => 'storybook');
		const res = (await gate(
			new Request('https://storybook.labelkit.co/iframe.html', {
				headers: { authorization: basic('', 'storybook') }
			}),
			{ next }
		)) as Response;
		expect(res.status).toBe(200);
		expect(res.headers.get('x-frame-options')).toBe('SAMEORIGIN');
		expect(res.headers.get('x-robots-tag')).toBe('noindex');
		expect(res.headers.get('cache-control')).toBe('private, no-store');
	});

	it('decodes UTF-8 credentials', async () => {
		const utf8 = (text: string) =>
			`Basic ${btoa(String.fromCharCode(...new TextEncoder().encode(text)))}`;
		expect(await passwordMatches(utf8('u:é'), 'é')).toBe(true);
		expect(await passwordMatches(utf8('u:e'), 'é')).toBe(false);
	});

	it('allows colons in the password', async () => {
		expect(await passwordMatches(basic('u', 'a:b'), 'a:b')).toBe(true);
		expect(await passwordMatches(basic('u', 'a'), 'a:b')).toBe(false);
	});
});
