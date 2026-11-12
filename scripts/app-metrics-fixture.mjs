import { createServer } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { sentrySvelteKit } from '@sentry/sveltekit/vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, cp, symlink, rm, realpath, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import http from 'node:http';
import https from 'node:https';
const repo = resolve(fileURLToPath(new URL('..', import.meta.url)));
const temporary = await realpath(await mkdtemp(resolve(tmpdir(), 'erms-metrics-fixture-')));
await cp(resolve(repo, 'scripts/fixtures/app-metrics'), temporary, { recursive: true });
await symlink(resolve(repo, 'node_modules'), resolve(temporary, 'node_modules'), 'dir');
await writeFile(
	resolve(temporary, 'src/hooks.client.ts'),
	(await readFile(resolve(repo, 'src/hooks.client.ts'), 'utf8'))
		.replace(
			"import { PUBLIC_SENTRY_DSN } from '$app/env/public';",
			'const PUBLIC_SENTRY_DSN="https://fake@example.invalid/1";'
		)
		.replace('tracesSampleRate: PUBLIC_SENTRY_DSN ? 0.1 : 0', 'tracesSampleRate: 1')
		.replace(
			'Sentry.init({',
			'Sentry.init({ transport: () => ({ send: async (envelope) => { (globalThis.fixtureEnvelopes ??= []).push(envelope); return {}; }, flush: async () => true }),'
		)
);
process.chdir(temporary);
// Prevent server-side egress. SSR must never rely on browser interception for isolation.
const realFetch = globalThis.fetch;
globalThis.fetch = (input, ...args) => {
	const url = new URL(typeof input === 'string' ? input : (input.url ?? input.href));
	if (!['127.0.0.1', 'localhost'].includes(url.hostname))
		throw new Error('fixture denied server egress');
	return realFetch(input, ...args);
};
for (const module of [http, https]) {
	module.request = () => {
		throw new Error('fixture denied server egress');
	};
	module.get = () => {
		throw new Error('fixture denied server egress');
	};
}
let server;
let fixtureOrigin;
let onRequest = (_req, _res, next) => next();
try {
	server = await createServer({
		configFile: false,
		envDir: false,
		root: temporary,
		logLevel: 'error',
		resolve: {
			alias: {
				'@metrics': resolve(repo, 'src/lib'),
				'#lib': resolve(repo, 'src/lib'),
				'@metrics-endpoint': resolve(repo, 'src/routes/api/app-metrics/+server.ts'),
				'@auth-callback': resolve(repo, 'src/routes/auth/callback/+server.ts'),
				'@auth-confirm': resolve(repo, 'src/routes/auth/confirm/+server.ts')
			}
		},
		define: { __SENTRY_ENVIRONMENT__: JSON.stringify('production'), __SENTRY_RELEASE__: 'null' },
		plugins: [
			{
				name: 'fixture-private-env',
				enforce: 'pre',
				configureServer(s) {
					s.middlewares.use((req, res, next) => onRequest(req, res, next));
				},
				transform(code, id, options) {
					if (!options?.ssr) return;
					if (id === resolve(repo, 'src/lib/app-metrics-contract.ts'))
						return code.replace(
							/export const METRICS_ORIGINS = \[[^\]]*\] as const;/,
							`export const METRICS_ORIGINS = [${JSON.stringify(fixtureOrigin)}] as const;`
						);
					if (id === resolve(repo, 'src/routes/api/app-metrics/+server.ts'))
						return code.replace(
							"import { APP_METRICS_ENABLED } from '$app/env/private';",
							'const APP_METRICS_ENABLED=true;'
						);
					if (id === resolve(repo, 'src/lib/server/db/client.ts'))
						return code.replace(
							"import { DATABASE_URL } from '$app/env/private';",
							'const DATABASE_URL=' + JSON.stringify(process.env.METRICS_TEST_DATABASE_URL) + ';'
						);
				}
			},
			...(await sentrySvelteKit({ autoInstrument: false, autoUploadSourceMaps: false })),
			await sveltekit()
		],
		server: { host: '127.0.0.1', port: 0, fs: { allow: [repo, temporary] } }
	});
	// Only this disposable fixture's SSR transform configures a loopback origin.
	// The actual endpoint and production restricted runner execute unchanged below.
	let run = async (fn) => fn({ execute: async () => [{ accepted: true }] });
	let endpoint;
	if (process.env.METRICS_TEST_DATABASE_URL) {
		const host = new URL(process.env.METRICS_TEST_DATABASE_URL).hostname;
		if (!['127.0.0.1', 'localhost', '[::1]'].includes(host))
			throw new Error('fixture DB must be local');
	}
	const wire = [];
	let mode = 'ok';
	onRequest = async (req, res, next) => {
		if (req.url === '/fixture-auth-inputs') {
			res.setHeader('content-type', 'application/json');
			res.end(JSON.stringify(globalThis.fixtureAuthInputs ?? []));
			return;
		}
		if (req.url === '/fixture-ledger') {
			res.setHeader('content-type', 'application/json');
			res.end(JSON.stringify(wire));
			return;
		}
		if (req.url?.startsWith('/fixture-mode/')) {
			mode = req.url.split('/').pop();
			res.end();
			return;
		}
		if (req.url === '/control') {
			wire.push({ control: true, headers: req.headers });
		}
		if (req.url !== '/api/app-metrics') return next();
		const chunks = [];
		for await (const chunk of req) chunks.push(chunk);
		const body = Buffer.concat(chunks);
		const entry = { headers: req.headers, body: body.toString(), mode };
		wire.push(entry);
		if (mode === 'redirect') {
			res.writeHead(302, { location: 'http://localhost:1/FAKE_REDIRECT' });
			res.end();
			return;
		}
		if (mode === 'netfail') {
			res.destroy();
			return;
		}
		if (/^status-\d+$/.test(mode)) {
			res.writeHead(Number(mode.slice(7)));
			res.end();
			return;
		}
		if (mode === 'timeout') {
			setTimeout(() => res.end(), 1500);
			return;
		}
		const origin = `http://${req.headers.host}`;
		// Real wire headers go unchanged into the actual endpoint. Canonical origin is fixture-build configuration only.
		const request = new Request(origin + '/api/app-metrics', {
			method: 'POST',
			headers: req.headers,
			body
		});

		const response = await endpoint.POST({ request, locals: { db: run } });
		entry.status = response.status;
		res.writeHead(response.status, Object.fromEntries(response.headers));
		res.end();
	};
	await server.listen();
	fixtureOrigin = `http://127.0.0.1:${server.httpServer.address().port}`;
	// Warm module compilation before the one-second native-fetch transport deadline.
	{
		endpoint = await server.ssrLoadModule(resolve(repo, 'src/routes/api/app-metrics/+server.ts'));
		if (process.env.METRICS_TEST_DATABASE_URL) {
			const { metricsRunner } = await server.ssrLoadModule(
				resolve(repo, 'src/lib/server/db/client.ts')
			);
			run = metricsRunner('labelkit_metrics_ingest');
		}
	}
	process.stdout.write(
		JSON.stringify({
			origin: `http://127.0.0.1:${server.httpServer.address().port}`,
			storage: !!process.env.METRICS_TEST_DATABASE_URL
		}) + '\n'
	);
	process.on('SIGTERM', async () => {
		await server.close();
		await rm(temporary, { recursive: true, force: true });
		process.exit(0);
	});
} catch (error) {
	process.stderr.write(String(error) + '\n');
	await server?.close();
	await rm(temporary, { recursive: true, force: true });
	process.exit(1);
}
