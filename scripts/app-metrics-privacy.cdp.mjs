/** No package/browser download. Uses Node 22 WebSocket and an installed Chrome. */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn) {
	const end = Date.now() + 10000;
	while (Date.now() < end) {
		const result = await fn();
		if (result) return result;
		await wait(50);
	}
	throw new Error('fixture barrier timed out');
}
const chrome =
	process.env.CHROME_BIN ??
	(process.platform === 'darwin'
		? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
		: execFileSync('which', ['google-chrome'], { encoding: 'utf8' }).trim());
const profile = await mkdtemp(resolve(tmpdir(), 'erms-metrics-chrome-'));
let browser, fixture, socket;
let failureOutput = '';
const ledger = [];
const denied = [];
const pageErrors = [];
try {
	fixture = spawn(process.execPath, ['scripts/app-metrics-fixture.mjs'], {
		stdio: ['ignore', 'pipe', 'pipe'],
		env: { ...process.env, SENTRY_AUTH_TOKEN: '', SENTRY_DSN: '', PUBLIC_SENTRY_DSN: '' }
	});
	let startup = '';
	fixture.stdout.on('data', (d) => (startup += d));
	fixture.stderr.on('data', (d) => (failureOutput += d));
	const { origin, storage } = await until(() => {
		if (fixture.exitCode !== null) throw new Error('Fixture failed: ' + failureOutput);
		for (const line of startup.split('\n')) {
			try {
				const value = JSON.parse(line);
				if (value.origin) return value;
			} catch {}
		}
	});
	browser = spawn(
		chrome,
		[
			'--headless=new',
			'--no-sandbox',
			'--disable-background-networking',
			'--disable-component-update',
			'--disable-sync',
			'--no-first-run',
			'--remote-debugging-address=127.0.0.1',
			'--remote-debugging-port=0',
			`--user-data-dir=${profile}`
		],
		{ stdio: ['ignore', 'ignore', 'pipe'] }
	);
	let stderr = '';
	browser.stderr.on('data', (d) => (stderr += d));
	const ws = await until(() => stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1]);
	socket = new WebSocket(ws);
	await new Promise((r, j) => {
		socket.onopen = r;
		socket.onerror = j;
	});
	let id = 0;
	const pending = new Map();
	const handlers = new Map();
	socket.onmessage = async ({ data }) => {
		const m = JSON.parse(data);
		if (m.id) {
			const p = pending.get(m.id);
			pending.delete(m.id);
			m.error ? p?.reject(new Error(m.error.message)) : p?.resolve(m.result);
			return;
		}
		for (const handler of handlers.get(m.method) ?? []) await handler(m.params, m.sessionId);
	};
	const send = (method, params = {}, sessionId) =>
		new Promise((resolve, reject) => {
			const n = ++id;
			pending.set(n, { resolve, reject });
			socket.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
		});
	const version = await send('Browser.getVersion');
	const { browserContextId } = await send('Target.createBrowserContext');
	const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId });
	const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
	const command = (method, params = {}) => send(method, params, sessionId);
	handlers.set('Runtime.exceptionThrown', [(p) => pageErrors.push(p.exceptionDetails.text)]);
	handlers.set('Fetch.requestPaused', [
		async (p, s) => {
			const url = p.request.url;
			if (url.startsWith(origin + '/')) {
				if (url === origin + '/api/app-metrics')
					ledger.push({
						url,
						method: p.request.method,
						headers: p.request.headers,
						body: p.request.postData
					});
				await send('Fetch.continueRequest', { requestId: p.requestId }, s);
			} else {
				denied.push(url);
				await send(
					'Fetch.failRequest',
					{ requestId: p.requestId, errorReason: 'BlockedByClient' },
					s
				);
			}
		}
	]);
	await command('Page.enable');
	await command('Runtime.enable');
	await command('Network.enable');
	await command('Network.setCacheDisabled', { cacheDisabled: true });
	await command('Network.setBypassServiceWorker', { bypass: true });
	await command('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
	await command('Network.setCookies', {
		cookies: [
			{
				name: 'sb-fake-auth-token',
				value: 'FAKE_METRIC_SECRET_HTTPONLY',
				url: origin,
				httpOnly: true
			},
			{ name: 'ak_console_session', value: 'FAKE_METRIC_SECRET_COOKIE', url: origin }
		]
	});
	const evaluate = async (expression) => {
		const r = await command('Runtime.evaluate', {
			expression,
			awaitPromise: true,
			returnByValue: true
		});
		if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
		return r.result.value;
	};
	await command('Page.addScriptToEvaluateOnNewDocument', {
		source: `window.fixtureEnabled=true; localStorage.setItem('FAKE_METRIC_SECRET','fake-user@example.invalid'); sessionStorage.setItem('FAKE_METRIC_SECRET','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'); navigator.serviceWorker?.getRegistrations().then(rs=>rs.forEach(r=>r.unregister()));`
	});
	const navigate = async (path) => {
		await command('Page.navigate', { url: origin + path });
		await until(() => evaluate('typeof fixtureGoto === "function"'));
		await wait(200);
	};
	const wire = () => fetch(origin + '/fixture-ledger').then((r) => r.json());
	await navigate('/?token=FAKE_METRIC_SECRET#FAKE_METRIC_SECRET');

	await until(async () => (await wire()).some((r) => r.body));
	await evaluate(`fetch('/control').then(()=>true)`);
	let records = await wire();
	assert(records.find((r) => r.control)?.headers.cookie.includes('FAKE_METRIC_SECRET'));
	const initialCount = records.filter((r) => r.body).length;
	assert.equal(initialCount, 1);
	await evaluate(
		`fixtureGoto('/releases/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa?token=FAKE_METRIC_SECRET')`
	);
	await evaluate(
		`window.dispatchEvent(new PageTransitionEvent('pagehide'));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));`
	);
	await evaluate(`history.back()`);
	await wait(300);
	await evaluate(`history.forward()`);
	await wait(300);
	await evaluate(`fixtureGoto('/')`);
	await wait(1200);
	assert.equal((await wire()).filter((r) => r.body).length, initialCount);
	// Callback is an actual local HTTP 303 fixture, not a real Auth exchange.
	await navigate('/auth/callback?code=FAKE_METRIC_SECRET');
	await until(async () => (await wire()).filter((r) => r.body).length === 2);
	assert.equal(await evaluate('location.pathname'), '/');
	const beforeFailure = (await wire()).filter((r) => r.body).length;
	for (const mode of ['failure', 'redirect', 'timeout']) {
		await fetch(origin + '/fixture-mode/' + mode);
		await navigate('/?q=FAKE_METRIC_SECRET');
		await wait(1500);
	}
	assert.equal((await wire()).filter((r) => r.body).length, beforeFailure + 3);
	await fetch(origin + '/fixture-mode/ok');
	// New-document disabled case: constructor receives disabled, with all other state unchanged.
	await command('Page.addScriptToEvaluateOnNewDocument', {
		source: 'window.fixtureEnabled=false;'
	});
	const beforeDisabled = (await wire()).filter((r) => r.body).length;
	await navigate('/?token=FAKE_METRIC_SECRET');
	await evaluate(`fixtureGoto('/releases/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');`);
	await wait(1200);
	assert.equal((await wire()).filter((r) => r.body).length, beforeDisabled);
	records = (await wire()).filter((r) => r.body);
	for (const r of records) {
		for (const name of [
			'cookie',
			'authorization',
			'proxy-authorization',
			'referer',
			'baggage',
			'sentry-trace',
			'traceparent',
			'tracestate'
		])
			assert.equal(r.headers[name], undefined, name);
		assert.equal(r.headers.origin, origin);
		assert.equal(r.headers['sec-fetch-site'], 'same-origin');
		assert.equal(r.headers['content-type'], 'application/json');
		assert(Buffer.byteLength(r.body) <= 256);
		const sample = JSON.parse(r.body);
		assert.deepEqual(Object.keys(sample).sort(), ['metric', 'ms', 'route', 'v']);
		assert.equal(sample.v, 1);
		assert.equal(sample.route, 'catalog_home');
		assert.equal(sample.metric, 'document_mount_ms');
		assert(Number.isInteger(sample.ms) && sample.ms >= 0 && sample.ms <= 60000);
		assert(
			!/FAKE|aaaaaaaa|example\.invalid/i.test(JSON.stringify({ headers: r.headers, body: r.body }))
		);
	}
	assert.equal(denied.length, 0, 'unexpected browser egress: ' + JSON.stringify(denied));
	assert.equal(
		await evaluate(
			'JSON.stringify(globalThis.fixtureEnvelopes ?? []).includes("/api/app-metrics")'
		),
		false,
		'collector Sentry capture'
	);
	assert.deepEqual(pageErrors, []);
	const proof = {
		driver: 'Node CDP',
		node: process.version,
		browser: version.product,
		clientHash: createHash('sha256')
			.update(readFileSync('src/lib/app-metrics-client.ts'))
			.digest('hex'),
		wireAttempts: records.length,
		accepted: records.filter((r) => r.status === 204).length,
		storage,
		syntheticLifecycle: ['pagehide', 'pageshow persisted'],
		gaps: [
			'physical tab hide',
			'genuine BFCache',
			'Secure cookies over TLS',
			'production Netlify/platform logging'
		],
		unknownRequests: denied.length,
		pageErrors: pageErrors.length
	};
	await writeFile(
		process.env.METRICS_PROOF_PATH ?? resolve(tmpdir(), 'erms-app-metrics-proof.json'),
		JSON.stringify(proof, null, 2) + '\n'
	);
	console.log(JSON.stringify(proof));
	if (storage) {
		const { default: postgres } = await import('postgres');
		const sql = postgres(process.env.METRICS_TEST_DATABASE_URL, { max: 1 });
		const totals =
			await sql`select sum(count)::int as n from app_metrics.app_performance_daily where route_code=1`;
		assert.equal(totals[0].n, proof.accepted);
		await sql.end();
	}
	await send('Target.disposeBrowserContext', { browserContextId });
} catch (error) {
	console.error(error);
	if (failureOutput) console.error(failureOutput);
	process.exitCode = 1;
} finally {
	socket?.close();
	browser?.kill('SIGTERM');
	fixture?.kill('SIGTERM');
	await wait(250);
	await rm(profile, { recursive: true, force: true });
}
