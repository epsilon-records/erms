import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PUBLIC_PAGES } from '#lib/server/public-paths.js';
import {
	BEACON_PATHS,
	beaconConfig,
	needsFullLoad,
	shouldLoadBeacon,
	siteToken,
	type BeaconContext
} from './public-analytics.js';

const root = join(import.meta.dirname, '..', '..');
const routes = join(root, 'src', 'routes');
const SAFE = 'https://labelkit.co/';
const TOKEN = 'a'.repeat(32); // Test fixture only; never a configured site token.
const MARKER = 'FABRICATED_SECRET_7391';

function files(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]
	);
}

/** The URL path a route file serves: `src/routes/login/+page.svelte` → `/login`. */
function routePath(file: string): string {
	const dir = relative(routes, file).split(sep).slice(0, -1).join('/');
	return '/' + dir;
}

const pages = files(routes).filter((f) => f.endsWith('+page.svelte'));
const loads = (f: string) => /PublicAnalytics/.test(readFileSync(f, 'utf8'));

describe('which routes get the Cloudflare beacon', () => {
	it('is exactly the public signed-out pages, and every other page never mounts it', () => {
		const withLoader = pages.filter(loads).map(routePath).sort();
		expect(withLoader).toEqual(['/', '/login', '/privacy', '/signup', '/terms']);
		expect([...BEACON_PATHS].sort()).toEqual(withLoader);
		const without = pages.filter((f) => !loads(f)).map(routePath);
		// A sample of the signed-in app and the auth hand-offs, so a rename can't hide one.
		for (const path of [
			'/releases',
			'/releases/[id]',
			'/artists/[id]',
			'/members',
			'/onboarding',
			'/org/billing',
			'/org/api-keys',
			'/search',
			'/signup/label'
		])
			expect(without).toContain(path);
		for (const path of BEACON_PATHS) expect(without).not.toContain(path);
	});

	it('only allows paths a signed-out visitor can reach', () => {
		// `/` is the landing page (server/landing.ts); the rest are public by the hook's list.
		for (const path of BEACON_PATHS) if (path !== '/') expect(PUBLIC_PAGES).toContain(path);
		for (const path of ['/auth/callback', '/auth/confirm', '/signup/label'])
			expect(BEACON_PATHS).not.toContain(path);
	});

	it('mounts on / only for the signed-out landing page, never the dashboard', () => {
		const home = readFileSync(join(routes, '+page.svelte'), 'utf8');
		const landing = home.slice(home.indexOf('{#if data.landing}'), home.indexOf('{:else}'));
		expect(landing).toContain('<PublicAnalytics />');
		expect(home.slice(home.indexOf('{:else}'))).not.toContain('PublicAnalytics');
	});

	it('is never in a layout, the error page or the HTML shell', () => {
		for (const f of files(routes).filter((f) => /\+(layout|error)/.test(f)))
			expect(readFileSync(f, 'utf8'), f).not.toMatch(/PublicAnalytics|cloudflareinsights/);
		expect(readFileSync(join(root, 'src', 'app.html'), 'utf8')).not.toMatch(
			/cloudflareinsights|data-cf-beacon/
		);
		// Only the loader builds the beacon tag.
		const beacons = files(join(root, 'src'))
			.filter((f) => /\.(svelte|ts|js|html)$/.test(f) && !f.endsWith('.test.ts'))
			.filter((f) => /static\.cloudflareinsights\.com|data-cf-beacon/.test(readFileSync(f, 'utf8')))
			.map((f) => relative(root, f));
		expect(beacons.sort()).toEqual([
			join('src', 'lib', 'components', 'PublicAnalytics.svelte'),
			join('src', 'lib', 'public-analytics.ts')
		]);
	});
});

function ctx(over: Partial<BeaconContext> = {}): BeaconContext {
	return {
		token: TOKEN,
		environment: 'production',
		signedIn: false,
		href: SAFE,
		navigation: [{ name: over.href ?? SAFE }],
		referrer: '',
		installed: false,
		...over
	};
}

describe('shouldLoadBeacon', () => {
	it('loads on a clean public page in production', () => {
		for (const path of BEACON_PATHS) {
			const href = `https://labelkit.co${path}`;
			expect(shouldLoadBeacon(ctx({ href, navigation: [{ name: href }] })), path).toBe(true);
		}
		expect(shouldLoadBeacon(ctx({ referrer: 'https://labelkit.co/privacy' }))).toBe(true);
		expect(shouldLoadBeacon(ctx({ referrer: 'https://www.google.com/' }))).toBe(true);
	});

	it('loads nothing with the token unset or malformed', () => {
		for (const token of [undefined, '', 'UNKNOWN', 'example', 'a'.repeat(31), 'g'.repeat(32)])
			expect(shouldLoadBeacon(ctx({ token }))).toBe(false);
		expect(siteToken(undefined)).toBeUndefined();
		expect(siteToken(TOKEN)).toBe(TOKEN);
	});

	it('loads nothing outside the production context', () => {
		for (const environment of ['deploy-preview', 'branch-deploy', 'dev', 'development', ''])
			expect(shouldLoadBeacon(ctx({ environment }))).toBe(false);
	});

	it('loads nothing for a signed-in user, or twice', () => {
		expect(shouldLoadBeacon(ctx({ signedIn: true }))).toBe(false);
		expect(shouldLoadBeacon(ctx({ installed: true }))).toBe(false);
	});

	it('fails closed on the current URL, the original navigation and the referrer', () => {
		const unsafe = [
			`${SAFE}?token=${MARKER}`,
			`${SAFE}#${MARKER}`,
			`${SAFE}?`,
			`${SAFE}#`,
			'https://labelkit.co/login?link=invalid',
			'https://labelkit.co/auth/callback',
			'https://labelkit.co/auth/confirm',
			'https://labelkit.co/signup/label',
			'https://labelkit.co/releases',
			`https://labelkit.co/releases/${MARKER}`,
			'https://labelkit.co/search',
			'https://labelkit.co/org/billing',
			'https://labelkit.co/privacy/',
			'https://labelkit.co/%6Cogin',
			`https://user:${MARKER}@labelkit.co/`,
			'http://labelkit.co/',
			'not a URL'
		];
		for (const url of unsafe) {
			expect(shouldLoadBeacon(ctx({ href: url, navigation: [{ name: url }] })), url).toBe(false);
			expect(shouldLoadBeacon(ctx({ navigation: [{ name: url }] })), url).toBe(false);
			expect(shouldLoadBeacon(ctx({ referrer: url })), url).toBe(false);
		}
	});

	it('loads nothing after a client-side navigation from an app page', () => {
		// The document was loaded from /releases/…; the page now shown is /privacy.
		expect(
			shouldLoadBeacon(
				ctx({
					href: 'https://labelkit.co/privacy',
					navigation: [{ name: `https://labelkit.co/releases/${MARKER}` }]
				})
			)
		).toBe(false);
		for (const navigation of [[], [{ name: SAFE }, { name: SAFE }], [{}]])
			expect(shouldLoadBeacon(ctx({ navigation }))).toBe(false);
		expect(shouldLoadBeacon(ctx({ referrer: null }))).toBe(false);
	});

	it('loads nothing off labelkit.co: previews, customers’ domains, the API host, local dev', () => {
		for (const host of [
			'erms.epsilonrecords.com',
			'deploy-preview-95--labelkit.netlify.app',
			'labelkit.netlify.app',
			'www.labelkit.co',
			'api.labelkit.co',
			'localhost'
		]) {
			const url = `https://${host}/`;
			expect(shouldLoadBeacon(ctx({ href: url, navigation: [{ name: url }] })), host).toBe(false);
			expect(shouldLoadBeacon(ctx({ navigation: [{ name: url }] })), host).toBe(false);
		}
	});

	it('configures a manual beacon without single-page-app tracking', () => {
		expect(JSON.parse(beaconConfig(TOKEN))).toEqual({ token: TOKEN, spa: false });
	});
});

describe('needsFullLoad: the beacon never follows a client-side navigation', () => {
	const from = 'https://labelkit.co/';
	it('turns every move to another page or query into a full page load', () => {
		for (const to of [
			'https://labelkit.co/login',
			'https://labelkit.co/releases',
			`https://labelkit.co/?q=${MARKER}`,
			'https://labelkit.co/signup',
			'https://epsilonrecords.com/'
		])
			expect(needsFullLoad(from, new URL(to)), to).toBe(true);
	});

	it('keeps jumps within the same page client-side', () => {
		expect(needsFullLoad(from, new URL('https://labelkit.co/#pricing'))).toBe(false);
		expect(needsFullLoad(from, null)).toBe(false);
	});
});

describe('privacy notice', () => {
	it('names Cloudflare Web Analytics and where it runs', () => {
		const notice = readFileSync(join(routes, 'privacy', '+page.svelte'), 'utf8').replace(
			/\s+/g,
			' '
		);
		expect(notice).toContain('Cloudflare Web Analytics');
		expect(notice).toContain('never loaded once you are signed in');
	});
});

describe('CSP for the beacon', () => {
	const config = readFileSync(join(root, 'vite.config.ts'), 'utf8');
	it('allows the beacon script and its endpoint, and nothing broader', () => {
		expect(config).toMatch(/'script-src': \['self', 'https:\/\/static\.cloudflareinsights\.com'\]/);
		expect(config).toMatch(/'connect-src': \[[^\]]*'https:\/\/cloudflareinsights\.com'[^\]]*\]/);
		expect(config).not.toMatch(/\*\.cloudflareinsights\.com/);
	});
});
