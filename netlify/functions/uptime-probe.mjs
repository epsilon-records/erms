/**
 * Uptime prober (shared decision 0010, EPSILON-89).
 *
 * Sentry's plan allows one uptime monitor, spent on the AudioKit API (shared 0009). This scheduled
 * function covers the other four endpoints. Every run GETs each one; a non-2xx answer, a timeout
 * or a network error sends ONE Sentry error event for that endpoint, tagged
 * environment=production, which rule 6309992 "Production: new or regressed error → email Nate"
 * turns into an email.
 *
 * - Interval: every 5 minutes, the same cadence as the Sentry monitor on the API (300 s).
 * - Timeout: 10 s per endpoint, also the monitor's. Probes run in parallel, so a run takes at
 *   most ~10 s, inside Netlify's 30 s limit for scheduled functions.
 * - Redirects are followed (fetch's default, up to 20 hops) and only the final answer counts.
 *   console.audiokit.ai/ answers 303 → /login; what matters is that the login page a person lands
 *   on serves a 2xx. A redirect into a dead page is caught; a bare 3xx is not mistaken for "down".
 * - Grouping: each event carries the fingerprint ['uptime-probe', <endpoint>], so a long outage
 *   is one Sentry issue per endpoint (its event count grows every 5 minutes), not hundreds of
 *   issues. The rule emails on first-seen, regression and reappearance. Once the endpoint is back,
 *   resolve the issue so the next outage counts as a regression and emails again.
 *
 * Events go straight to Sentry's envelope endpoint with the ERMS project's DSN (shared 0003,
 * one project per deployable). No SDK is loaded: this function is bundled on its own, outside the
 * SvelteKit build, and an envelope is one POST.
 *
 * Netlify runs scheduled functions on published deploys only, never on deploy previews, so
 * "production" is the only environment this can report from.
 */

export const ENDPOINTS = [
	'https://billing.audiokit.ai/ready',
	'https://console.audiokit.ai',
	'https://audiokit.ai',
	'https://erms.epsilonrecords.com/login'
];

/**
 * Extra URLs from UPTIME_PROBE_EXTRA_URLS (comma or whitespace separated), probed in addition to
 * ENDPOINTS. It exists so the failure path can be tested live without a code deploy: add one URL
 * that answers 404, wait one run, check Sentry and the email, then remove the variable. Unset or
 * empty means no extras. An entry that is not an http(s) URL throws, so a typo fails the run in the
 * Netlify log instead of silently probing nothing.
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
export function extraEndpoints(env) {
	const raw = (env.UPTIME_PROBE_EXTRA_URLS ?? '').split(/[\s,]+/).filter(Boolean);
	const extras = raw.map((entry) => {
		let u;
		try {
			u = new URL(entry);
		} catch {
			throw new Error('UPTIME_PROBE_EXTRA_URLS holds an entry that is not a URL');
		}
		if (u.protocol !== 'https:' && u.protocol !== 'http:') {
			throw new Error('UPTIME_PROBE_EXTRA_URLS entries must be http(s) URLs');
		}
		return u.href;
	});
	return [...new Set(extras)].filter((url) => !ENDPOINTS.includes(url));
}

export const TIMEOUT_MS = 10_000;
export const ENVIRONMENT = 'production';

/**
 * @typedef {{
 *   url: string;
 *   up: boolean;
 *   ms: number;
 *   status?: number;
 *   reason?: 'status' | 'timeout' | 'network';
 *   finalUrl?: string;
 *   detail?: string;
 * }} Outcome
 */

/**
 * Probe one endpoint. Never throws: the outcome says whether it is up and, if not, why.
 * @param {string} url
 * @param {{ timeoutMs?: number; fetchImpl?: typeof fetch }} [options]
 * @returns {Promise<Outcome>}
 */
export async function probe(url, { timeoutMs = TIMEOUT_MS, fetchImpl = fetch } = {}) {
	const started = Date.now();
	try {
		const res = await fetchImpl(url, {
			method: 'GET',
			redirect: 'follow',
			cache: 'no-store',
			headers: { 'user-agent': 'erms-uptime-probe (+https://erms.epsilonrecords.com)' },
			signal: AbortSignal.timeout(timeoutMs)
		});
		// Only the status matters; don't keep the connection busy reading the page.
		await res.body?.cancel().catch(() => {});
		const ms = Date.now() - started;
		if (res.status >= 200 && res.status < 300) return { url, up: true, status: res.status, ms };
		return {
			url,
			up: false,
			reason: 'status',
			status: res.status,
			finalUrl: res.url || url,
			ms,
			detail: `HTTP ${res.status}`
		};
	} catch (caught) {
		const e = /** @type {{ name?: string; message?: string; cause?: { code?: string } }} */ (
			caught
		);
		const ms = Date.now() - started;
		const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError';
		return {
			url,
			up: false,
			reason: timedOut ? 'timeout' : 'network',
			ms,
			detail: timedOut
				? `no answer within ${timeoutMs / 1000} s`
				: `request failed: ${e?.cause?.code ?? e?.message ?? String(caught)}`
		};
	}
}

/**
 * Split a DSN (https://<key>@<host>/<project>) into the envelope URL and its public key.
 * @param {string} dsn
 */
export function parseDsn(dsn) {
	const u = new URL(dsn);
	const projectId = u.pathname.replace(/^\/+|\/+$/g, '');
	if (!u.username || !projectId) throw new Error('SENTRY_DSN is not a valid Sentry DSN');
	return {
		envelopeUrl: `${u.protocol}//${u.host}/api/${projectId}/envelope/`,
		publicKey: u.username
	};
}

/**
 * The endpoint's host and path, the stable name its events are grouped and tagged by.
 * @param {string} url
 */
export const endpointName = (url) => {
	const u = new URL(url);
	return u.host + (u.pathname === '/' ? '' : u.pathname);
};

/**
 * One Sentry error event for a failed probe.
 * @param {Outcome} outcome
 */
export function failureEvent(outcome, now = new Date()) {
	const name = endpointName(outcome.url);
	return {
		event_id: crypto.randomUUID().replaceAll('-', ''),
		timestamp: now.getTime() / 1000,
		platform: 'javascript',
		level: 'error',
		logger: 'uptime-probe',
		environment: ENVIRONMENT,
		server_name: 'netlify-scheduled-function',
		exception: {
			values: [
				{
					type: 'UptimeProbeFailure',
					value: `${name} is down: ${outcome.detail}`,
					mechanism: { type: 'uptime-probe', handled: true }
				}
			]
		},
		// One issue per endpoint, however long the outage and whatever the status code.
		fingerprint: ['uptime-probe', name],
		tags: {
			probe_endpoint: name,
			probe_reason: outcome.reason,
			...(outcome.status ? { probe_status: String(outcome.status) } : {})
		},
		extra: {
			url: outcome.url,
			finalUrl: outcome.finalUrl ?? null,
			status: outcome.status ?? null,
			elapsedMs: outcome.ms,
			timeoutMs: TIMEOUT_MS
		}
	};
}

/**
 * POST one event to Sentry as an envelope. Throws if Sentry does not accept it.
 * @param {ReturnType<typeof failureEvent>} event
 * @param {string} dsn
 * @param {{ fetchImpl?: typeof fetch }} [options]
 */
export async function sendEvent(event, dsn, { fetchImpl = fetch } = {}) {
	const { envelopeUrl, publicKey } = parseDsn(dsn);
	const body =
		[
			JSON.stringify({ event_id: event.event_id, dsn, sent_at: new Date().toISOString() }),
			JSON.stringify({ type: 'event' }),
			JSON.stringify(event)
		].join('\n') + '\n';
	const res = await fetchImpl(envelopeUrl, {
		method: 'POST',
		headers: {
			'content-type': 'application/x-sentry-envelope',
			'x-sentry-auth': `Sentry sentry_version=7, sentry_key=${publicKey}, sentry_client=erms-uptime-probe/1`
		},
		body,
		signal: AbortSignal.timeout(TIMEOUT_MS)
	});
	if (!res.ok) throw new Error(`Sentry refused the event: HTTP ${res.status}`);
	return event.event_id;
}

/** One run: probe every endpoint, report each failure once. */
export async function run({ fetchImpl = fetch, env = process.env, timeoutMs = TIMEOUT_MS } = {}) {
	// SENTRY_DSN is the ERMS project's server DSN; the public one is the same project's.
	const dsn = env.SENTRY_DSN || env.PUBLIC_SENTRY_DSN;
	if (!dsn) throw new Error('SENTRY_DSN is required to report probe failures');
	parseDsn(dsn);

	const endpoints = [...ENDPOINTS, ...extraEndpoints(env)];
	const outcomes = await Promise.all(endpoints.map((url) => probe(url, { timeoutMs, fetchImpl })));
	const reported = [];
	const unreported = [];
	for (const o of outcomes) {
		const line = { msg: 'uptime probe', endpoint: endpointName(o.url), up: o.up, ms: o.ms };
		if (o.up) {
			console.log(JSON.stringify({ level: 'info', ...line, status: o.status }));
			continue;
		}
		try {
			const eventId = await sendEvent(failureEvent(o), dsn, { fetchImpl });
			reported.push(o.url);
			console.error(
				JSON.stringify({ level: 'error', ...line, reason: o.reason, detail: o.detail, eventId })
			);
		} catch (e) {
			unreported.push(o.url);
			console.error(
				JSON.stringify({
					level: 'error',
					...line,
					reason: o.reason,
					detail: o.detail,
					sentry: String(e)
				})
			);
		}
	}
	// A failure Sentry never heard about must not pass quietly: fail the run so Netlify logs it.
	if (unreported.length) throw new Error(`Could not report to Sentry: ${unreported.join(', ')}`);
	return { outcomes, reported };
}

export default async () => {
	await run();
};

export const config = { schedule: '*/5 * * * *' };
