import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import handler, {
	config,
	ENDPOINTS,
	extraEndpoints,
	failureEvent,
	parseDsn,
	probe,
	run,
	TIMEOUT_MS
} from '../../../netlify/functions/uptime-probe.mjs';

// A made-up DSN in the shape of the ERMS one; nothing here reaches Sentry.
const DSN = 'https://publickey123@o1.ingest.us.sentry.io/42';
const ENVELOPE_URL = 'https://o1.ingest.us.sentry.io/api/42/envelope/';

type Answer = number | 'timeout' | 'network';

/**
 * A fetch stand-in: probe URLs answer as `answers` says (200 by default), and Sentry
 * envelopes are recorded and answered with `sentryStatus`.
 */
function fakeFetch(answers: Record<string, Answer> = {}, sentryStatus = 200) {
	const envelopes: { headers: Record<string, string>; items: unknown[] }[] = [];
	const probes: { url: string; init?: RequestInit }[] = [];
	const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		if (url === ENVELOPE_URL) {
			const lines = String(init?.body).trim().split('\n');
			envelopes.push({
				headers: init?.headers as Record<string, string>,
				items: lines.map((l) => JSON.parse(l))
			});
			return new Response('{}', { status: sentryStatus });
		}
		probes.push({ url, init });
		const answer = answers[url] ?? 200;
		if (answer === 'timeout') throw new DOMException('The operation timed out.', 'TimeoutError');
		if (answer === 'network') throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
		return new Response(answer === 204 ? null : 'page', { status: answer });
	});
	const events = () => envelopes.map((e) => e.items[2] as ReturnType<typeof failureEvent>);
	return { impl: impl as unknown as typeof fetch, envelopes, probes, events };
}

const env = { SENTRY_DSN: DSN };

describe('uptime prober (shared decision 0010)', () => {
	beforeEach(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});
	afterEach(() => vi.restoreAllMocks());

	it('probes exactly the four endpoints the decision names, every 5 minutes, 10 s timeout', () => {
		expect(ENDPOINTS).toEqual([
			'https://billing.audiokit.ai/ready',
			'https://console.audiokit.ai',
			'https://audiokit.ai',
			'https://erms.epsilonrecords.com/login'
		]);
		expect(config.schedule).toBe('*/5 * * * *');
		expect(TIMEOUT_MS).toBe(10_000);
	});

	it('probes UPTIME_PROBE_EXTRA_URLS as well, and a failing extra sends one event of its own', async () => {
		const bad = 'https://erms.epsilonrecords.com/uptime-probe-test-404';
		const f = fakeFetch({ [bad]: 404 });
		const out = await run({
			fetchImpl: f.impl,
			env: { ...env, UPTIME_PROBE_EXTRA_URLS: ` ${bad} ,${bad}` }
		});
		expect(f.probes.map((p) => p.url)).toEqual([...ENDPOINTS, bad]);
		expect(out.reported).toEqual([bad]);
		expect(f.events()).toHaveLength(1);
		expect(f.events()[0]).toMatchObject({
			environment: 'production',
			fingerprint: ['uptime-probe', 'erms.epsilonrecords.com/uptime-probe-test-404'],
			tags: { probe_status: '404', probe_reason: 'status' }
		});
	});

	it('ignores an unset or empty override, and refuses one that is not an http(s) URL', async () => {
		expect(extraEndpoints({})).toEqual([]);
		expect(extraEndpoints({ UPTIME_PROBE_EXTRA_URLS: ' ,  ' })).toEqual([]);
		expect(extraEndpoints({ UPTIME_PROBE_EXTRA_URLS: ENDPOINTS[3] })).toEqual([]);
		expect(() => extraEndpoints({ UPTIME_PROBE_EXTRA_URLS: 'not a url' })).toThrow(/not a URL/);
		expect(() => extraEndpoints({ UPTIME_PROBE_EXTRA_URLS: 'ftp://example.com/x' })).toThrow(
			/http\(s\)/
		);
		const f = fakeFetch();
		await expect(
			run({ fetchImpl: f.impl, env: { ...env, UPTIME_PROBE_EXTRA_URLS: 'oops' } })
		).rejects.toThrow(/not a URL/);
		expect(f.probes).toEqual([]);
	});

	it('sends nothing to Sentry when every endpoint answers 2xx', async () => {
		const f = fakeFetch({ 'https://audiokit.ai': 204 });
		const out = await run({ fetchImpl: f.impl, env });
		expect(f.probes.map((p) => p.url)).toEqual(ENDPOINTS);
		expect(f.probes.every((p) => p.init?.method === 'GET')).toBe(true);
		expect(out.reported).toEqual([]);
		expect(f.envelopes).toEqual([]);
	});

	it('follows redirects and judges the final answer', async () => {
		const f = fakeFetch();
		await run({ fetchImpl: f.impl, env });
		expect(f.probes.every((p) => p.init?.redirect === 'follow')).toBe(true);
		expect(f.probes.every((p) => p.init?.signal instanceof AbortSignal)).toBe(true);
	});

	it('sends one production error event per failing endpoint, and none for the healthy ones', async () => {
		const f = fakeFetch({
			'https://billing.audiokit.ai/ready': 503,
			'https://console.audiokit.ai': 'timeout'
		});
		const out = await run({ fetchImpl: f.impl, env });
		expect(out.reported).toEqual([
			'https://billing.audiokit.ai/ready',
			'https://console.audiokit.ai'
		]);
		expect(f.envelopes).toHaveLength(2);

		const [billing, console_] = f.events();
		expect(billing).toMatchObject({
			level: 'error',
			environment: 'production',
			fingerprint: ['uptime-probe', 'billing.audiokit.ai/ready'],
			tags: {
				probe_endpoint: 'billing.audiokit.ai/ready',
				probe_reason: 'status',
				probe_status: '503'
			},
			exception: {
				values: [
					{ type: 'UptimeProbeFailure', value: 'billing.audiokit.ai/ready is down: HTTP 503' }
				]
			}
		});
		expect(console_).toMatchObject({
			environment: 'production',
			fingerprint: ['uptime-probe', 'console.audiokit.ai'],
			tags: { probe_endpoint: 'console.audiokit.ai', probe_reason: 'timeout' }
		});
		expect(console_.tags).not.toHaveProperty('probe_status');
	});

	it('treats a 3xx that is not followed through, a 404 and a network error as down', async () => {
		const f = fakeFetch({
			'https://billing.audiokit.ai/ready': 404,
			'https://audiokit.ai': 'network',
			'https://erms.epsilonrecords.com/login': 302
		});
		await run({ fetchImpl: f.impl, env });
		expect(f.events().map((e) => [e.tags.probe_endpoint, e.tags.probe_reason])).toEqual([
			['billing.audiokit.ai/ready', 'status'],
			['audiokit.ai', 'network'],
			['erms.epsilonrecords.com/login', 'status']
		]);
		expect(f.events()[1].exception.values[0].value).toContain('ENOTFOUND');
	});

	it('groups a long outage into one issue: same fingerprint every run, whatever the status', async () => {
		const first = fakeFetch({ 'https://audiokit.ai': 502 });
		const later = fakeFetch({ 'https://audiokit.ai': 'timeout' });
		await run({ fetchImpl: first.impl, env });
		await run({ fetchImpl: later.impl, env });
		const [a] = first.events();
		const [b] = later.events();
		expect(a.fingerprint).toEqual(b.fingerprint);
		expect(a.event_id).not.toEqual(b.event_id);
		expect(a.event_id).toMatch(/^[0-9a-f]{32}$/);
	});

	it('posts a well-formed envelope authenticated with the DSN’s public key', async () => {
		const f = fakeFetch({ 'https://audiokit.ai': 500 });
		await run({ fetchImpl: f.impl, env });
		const [{ headers, items }] = f.envelopes;
		expect(headers['content-type']).toBe('application/x-sentry-envelope');
		expect(headers['x-sentry-auth']).toContain('sentry_key=publickey123');
		expect(headers['x-sentry-auth']).toContain('sentry_version=7');
		const [envHeader, itemHeader, event] = items as [
			{ event_id: string; dsn: string },
			{ type: string },
			{ event_id: string }
		];
		expect(envHeader.dsn).toBe(DSN);
		expect(envHeader.event_id).toBe(event.event_id);
		expect(itemHeader).toEqual({ type: 'event' });
	});

	it('fails the run loudly when Sentry refuses an event', async () => {
		const f = fakeFetch({ 'https://audiokit.ai': 500 }, 429);
		await expect(run({ fetchImpl: f.impl, env })).rejects.toThrow(
			/Could not report to Sentry: https:\/\/audiokit.ai/
		);
	});

	it('refuses to run without a DSN, before probing anything', async () => {
		const f = fakeFetch();
		await expect(run({ fetchImpl: f.impl, env: {} })).rejects.toThrow(/SENTRY_DSN/);
		await expect(run({ fetchImpl: f.impl, env: { SENTRY_DSN: 'not a dsn' } })).rejects.toThrow();
		expect(f.probes).toEqual([]);
	});

	it('falls back to the public DSN of the same project', async () => {
		const f = fakeFetch({ 'https://audiokit.ai': 500 });
		await run({ fetchImpl: f.impl, env: { PUBLIC_SENTRY_DSN: DSN } });
		expect(f.envelopes).toHaveLength(1);
	});

	it('aborts a probe that takes longer than the timeout', async () => {
		// A server that never answers: only the probe's own AbortSignal can end the request.
		const silent = (_: RequestInfo | URL, init?: RequestInit) =>
			new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
			});
		const out = await probe('https://audiokit.ai', {
			timeoutMs: 50,
			fetchImpl: silent as unknown as typeof fetch
		});
		expect(out).toMatchObject({ up: false, reason: 'timeout' });
		expect(out.detail).toContain('0.05 s');
	});

	it('the scheduled handler runs with the real environment', async () => {
		vi.stubEnv('SENTRY_DSN', '');
		vi.stubEnv('PUBLIC_SENTRY_DSN', '');
		await expect(handler()).rejects.toThrow(/SENTRY_DSN/);
		vi.unstubAllEnvs();
	});

	it('parses the DSN into the envelope endpoint', () => {
		expect(parseDsn(DSN)).toEqual({ envelopeUrl: ENVELOPE_URL, publicKey: 'publickey123' });
	});
});
