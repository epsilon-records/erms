import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isMachineRoute, isPublicPath, MACHINE_ROUTES } from './public-paths';

/**
 * Invariants between the machine endpoints, the environment they read and the docs that describe
 * them. These are the places drift showed up as a production bug rather than a logic bug:
 *  - `/api/audiokit/*` was blocked by the sign-in redirect (board #24). A route added without the
 *    exemption is that bug again, and it fails only for the bearer-token caller, not a browser.
 *  - The README claimed "Supabase Queues + Cron + an Edge Function" for a schedule that did not
 *    exist (EPSILON-63). A scheduled function whose target route is undocumented is the mirror
 *    image of that: the docs stop describing what runs.
 *  - A variable declared in `src/env.ts` but missing from `.env.example` gets set up wrong on the
 *    first deploy, which is how WORKER_SECRET came to be described as needing two matching values.
 * These tests read the source on purpose: the claim being checked is that the files agree.
 */

const ROOT = new URL('../../../', import.meta.url); // src/lib/server -> repo root
const read = (rel: string) => readFileSync(new URL(rel, ROOT), 'utf8');

const envSchema = read('src/env.ts');
const envExample = read('.env.example');
const readme = read('README.md');

/** How each cron the functions register is written in the README. */
const CRON_LANGUAGE: Record<string, string> = {
	'* * * * *': 'every minute',
	'*/15 * * * *': 'every 15 minutes'
};

const scheduledFunctions: Record<string, string> = {
	'audiokit-worker': 'netlify/functions/audiokit-worker.mjs',
	'audiokit-reconcile': 'netlify/functions/audiokit-reconcile.mjs'
};

/**
 * Every route under src/routes/api/audiokit/, read from the tree, with each `[param]` segment
 * replaced by a sample value so it can be checked against the hook's matcher.
 */
function machineRoutes(): string[] {
	const root = new URL('src/routes/api/audiokit/', ROOT);
	if (!existsSync(root)) return [];
	const found: string[] = [];
	const walk = (dir: URL, path: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const sub = new URL(`${entry.name}/`, dir);
			const segment = `${path}/${entry.name}`;
			if (existsSync(new URL('+server.ts', sub))) found.push(segment);
			walk(sub, segment);
		}
	};
	walk(root, '/api/audiokit');
	return found.sort();
}

const sample = (route: string) => route.replace(/\[[^\]]+\]/g, 'sample-id');

describe('machine endpoints', () => {
	it('pins the set of routes under /api/audiokit', () => {
		// A new route here is reachable without a session only if public-paths.ts lists it. If this
		// fails, decide whether the new route verifies its own credentials, then update both.
		expect(machineRoutes()).toEqual([
			'/api/audiokit/reconcile',
			'/api/audiokit/webhook',
			'/api/audiokit/webhook/[client_id]',
			'/api/audiokit/worker'
		]);
	});

	it('exempts exactly those routes from the sign-in redirect', () => {
		for (const route of machineRoutes()) {
			expect(isMachineRoute(sample(route)), route).toBe(true);
			expect(isPublicPath(sample(route)), route).toBe(true);
		}
		// Every listed machine route is a real route: under /api/audiokit, or the daily purge.
		for (const route of MACHINE_ROUTES) {
			const exists = route.startsWith('/api/audiokit/')
				? machineRoutes().includes(route)
				: existsSync(new URL(`src/routes${route}/+server.ts`, ROOT));
			expect(exists, route).toBe(true);
		}
	});

	it('does not exempt other paths under the same prefixes', () => {
		for (const path of [
			'/api/audiokit',
			'/api/audiokit/',
			'/api/audiokit/new-route',
			'/api/audiokit/worker/',
			'/api/audiokit/workerx',
			'/api/audiokit/webhook/',
			'/api/audiokit/webhook/sample-id/extra'
		]) {
			expect(isPublicPath(path), path).toBe(false);
		}
	});

	it('keeps src/env.ts and .env.example listing the same variables', () => {
		const declared = [...envSchema.matchAll(/^\t([A-Z][A-Z0-9_]+):/gm)].map((match) => match[1]);
		const documented = [...envExample.matchAll(/^([A-Z][A-Z0-9_]+)=/gm)].map((match) => match[1]);

		expect(declared.length).toBeGreaterThan(5);
		expect(
			declared.filter((key) => !documented.includes(key)),
			'declared but not in .env.example'
		).toEqual([]);
		expect(
			documented.filter((key) => !declared.includes(key)),
			'in .env.example but not declared'
		).toEqual([]);
	});

	it('schedules only routes that the README documents, at the interval it claims', () => {
		// Scoped to the section that describes the schedule: the route paths also appear elsewhere
		// in the README, so a file-wide includes() would still pass after the section went stale.
		const section =
			readme.split(/^### /m).find((block) => block.startsWith('AudioKit job schedule')) ?? '';
		expect(section.length, 'README lost its "AudioKit job schedule" section').toBeGreaterThan(0);

		for (const [name, file] of Object.entries(scheduledFunctions)) {
			const source = read(file);
			const target = source.match(/new URL\('([^']+)', siteUrl\)/)?.[1];
			expect(target, `${name} does not post to an /api/audiokit route`).toMatch(
				/^\/api\/audiokit\/\w+$/
			);
			expect(
				section.includes(target as string),
				`${target} is not documented in the schedule section`
			).toBe(true);

			// The prose interval must be the one the function actually asks Netlify for.
			const cron = source.match(/schedule: '([^']+)'/)?.[1];
			const phrase = CRON_LANGUAGE[cron as string];
			expect(
				phrase,
				`${name} uses an unmapped cron (${cron}) — add it to CRON_LANGUAGE`
			).toBeTruthy();
			expect(
				section.toLowerCase(),
				`${name} runs ${cron} but the README does not say "${phrase}"`
			).toContain(phrase);

			// #30: without a same-origin header SvelteKit's CSRF guard 403s the call before the
			// route's bearer check runs. Nothing else keeps that requirement visible.
			expect(source, `${name} dropped the origin header the CSRF guard requires`).toContain(
				'origin: siteUrl'
			);

			expect(source, `${name} no longer reads WORKER_SECRET`).toContain(
				'process.env.WORKER_SECRET'
			);
		}
	});

	it('authenticates the machine routes with the bearer secret, not a session', () => {
		for (const route of ['/worker', '/reconcile']) {
			const source = read(`src/routes/api/audiokit${route}/+server.ts`);
			expect(source, `${route} does not check the worker bearer token`).toContain(
				'isAuthorizedWorkerRequest'
			);
		}
		// The webhook is the odd one out: HMAC-verified by the provider signature, not WORKER_SECRET.
		const webhook = read('src/routes/api/audiokit/webhook/+server.ts');
		expect(webhook).toContain('x-signature');
		expect(webhook).not.toContain('isAuthorizedWorkerRequest');
	});
});
