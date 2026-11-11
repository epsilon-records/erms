import { render } from 'svelte/server';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '#lib/server/audit.js';
import { brandForHost, clearBrandCache, DEFAULT_BRAND, type Brand } from '#lib/server/branding.js';

/**
 * The login page says the brand of the host it was requested on (EPSILON-132): ERMS on
 * erms.epsilonrecords.com, LabelKit on labelkit.co, previews and anything unknown. These run
 * without Postgres: a stub stands in for the orgs lookup, holding the one row migration 0024 sets.
 */

const ERMS_ORG = { id: 'org-epsilon', name: 'Epsilon Records', displayName: 'ERMS', accent: null };
const DOMAINS: Record<string, typeof ERMS_ORG> = { 'erms.epsilonrecords.com': ERMS_ORG };

/** Answers brandForHost's select by the custom_domain it filters on. */
function stubDb(): Database {
	const dialect = new PgDialect();
	const chain = {
		from: () => chain,
		where: (cond: SQL) => {
			const [domain] = dialect.sqlToQuery(cond).params as string[];
			return { limit: async () => (DOMAINS[domain] ? [DOMAINS[domain]] : []) };
		}
	};
	return { select: () => chain } as unknown as Database;
}

const state = vi.hoisted(() => ({
	page: { url: new URL('https://labelkit.co/login'), data: {} as { brand?: Brand } }
}));
vi.mock('$app/state', () => state);

const { default: LoginPage } = await import('./+page.svelte');

async function loginOn(host: string) {
	const brand = await brandForHost(stubDb(), host);
	state.page.url = new URL(`https://${host}/login`);
	state.page.data = { brand };
	const props = { data: { signupOpen: false }, form: null } as never;
	return { brand, body: render(LoginPage, { props }).body };
}

const eyebrow = (body: string) => body.match(/class="eyebrow"><span>([^<]*)<\/span>/)?.[1];

describe('login page branding by host', () => {
	beforeEach(() => clearBrandCache());

	it('shows ERMS on erms.epsilonrecords.com, whatever the case or port', async () => {
		for (const host of ['erms.epsilonrecords.com', 'ERMS.EpsilonRecords.com:443']) {
			const { brand, body } = await loginOn(host);
			expect(brand.name).toBe('ERMS');
			expect(brand.orgId).toBe('org-epsilon');
			expect(eyebrow(body)).toBe('ERMS');
			expect(body).not.toContain('LabelKit');
		}
	});

	it('shows LabelKit on labelkit.co, previews, localhost and unknown hosts', async () => {
		for (const host of [
			'labelkit.co',
			'www.labelkit.co',
			'deploy-preview-70--labelkit.netlify.app',
			'feat-x--labelkit.netlify.app',
			'localhost:5173',
			'unknown.example.com'
		]) {
			const { brand, body } = await loginOn(host);
			expect(brand, host).toEqual(DEFAULT_BRAND);
			expect(eyebrow(body), host).toBe('LabelKit');
			expect(body, host).not.toContain('ERMS');
		}
	});

	it('falls back to LabelKit when no brand reached the page', () => {
		state.page.data = {};
		const props = { data: { signupOpen: false }, form: null } as never;
		expect(eyebrow(render(LoginPage, { props }).body)).toBe('LabelKit');
	});
});
