import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	inspectStream,
	inspectUrl,
	isR2Url,
	isWorkerBearer
} from '../../../netlify/lib/inspect-stream.mjs';
import background, {
	READ_DEADLINE_MS
} from '../../../netlify/functions/master-verify-background.mjs';
import schedule, { config } from '../../../netlify/functions/master-verify.mjs';
import { siteUrlFor } from '../../../netlify/lib/site-url.mjs';

/**
 * The background check of uploaded masters (EPSILON-120): the Netlify functions that lease
 * masters, stream each from R2 and report what they read. They run without Postgres.
 */

const SITE_URL = 'https://labelkit.test';
const SECRET = 'worker-secret-under-test';
const R2_URL = 'https://acct.r2.cloudflarestorage.com/masters/orgs/o/m.wav?X-Amz-Signature=x';
const WAV = new TextEncoder().encode('RIFF\x24\x00\x00\x00WAVEfmt and the rest of the audio');
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const job = { id: '00000000-0000-7000-8000-000000000001', token: crypto.randomUUID(), url: R2_URL };

/** A stream that delivers `bytes` in chunks of `size`. */
function chunked(bytes: Uint8Array, size: number) {
	return new ReadableStream<Uint8Array>({
		start(c) {
			for (let i = 0; i < bytes.length; i += size) c.enqueue(bytes.slice(i, i + size));
			c.close();
		}
	});
}

/** A body that sends one chunk and then never another, until it is cancelled. */
function stalled(onCancel: () => void) {
	return new ReadableStream<Uint8Array>({
		start(c) {
			c.enqueue(WAV.slice(0, 4));
		},
		cancel: onCancel
	});
}

const bearer = (secret = SECRET) =>
	new Request(`${SITE_URL}/.netlify/functions/master-verify-background`, {
		method: 'POST',
		headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
		body: JSON.stringify({ jobs: [job] })
	});

beforeEach(() => {
	process.env.URL = SITE_URL;
	process.env.WORKER_SECRET = SECRET;
});
afterEach(() => {
	delete process.env.URL;
	delete process.env.WORKER_SECRET;
	vi.useRealTimers();
});

describe('inspectStream', () => {
	it('never returns a hash for a read cut off by its signal', async () => {
		const controller = new AbortController();
		const reading = inspectStream(
			stalled(() => {}),
			12,
			controller.signal
		);
		controller.abort(new Error('deadline'));
		await expect(reading).rejects.toThrow('deadline');
	});

	it('hashes a body that arrives in small chunks, keeping its first bytes', async () => {
		const bytes = new Uint8Array(1000).map((_, i) => i % 251);
		expect(await inspectStream(chunked(bytes, 7), 12)).toEqual({
			sha256: sha(bytes),
			size: 1000,
			start: bytes.slice(0, 12)
		});
		expect((await inspectStream(chunked(new Uint8Array([1, 2]), 1), 12)).start).toEqual(
			new Uint8Array([1, 2])
		);
	});
});

describe('inspectUrl', () => {
	it('gives up on a stalled read at its deadline and cancels the body', async () => {
		let cancelled = false;
		// The body never ends and ignores the fetch signal: the read itself must give up.
		const fetchImpl = (async () =>
			new Response(stalled(() => (cancelled = true)))) as unknown as typeof fetch;
		await expect(
			inspectUrl(R2_URL, { deadlineMs: 50, headerBytes: 12, fetchImpl })
		).rejects.toThrow();
		expect(cancelled).toBe(true);
	});

	it('passes the overall deadline to the GET', async () => {
		let signal: AbortSignal | undefined;
		const fetchImpl = (async (_url: string, init?: RequestInit) => {
			signal = init?.signal ?? undefined;
			return new Response(WAV);
		}) as typeof fetch;
		await inspectUrl(R2_URL, { deadlineMs: 1000, headerBytes: 12, fetchImpl });
		expect(signal).toBeInstanceOf(AbortSignal);
	});

	it('fails on a non-2xx answer', async () => {
		const fetchImpl = (async () => new Response('gone', { status: 404 })) as typeof fetch;
		await expect(
			inspectUrl(R2_URL, { deadlineMs: 1000, headerBytes: 12, fetchImpl })
		).rejects.toThrow(/404/);
	});
});

describe('guards', () => {
	it('accepts only the worker bearer secret', () => {
		expect(isWorkerBearer(`Bearer ${SECRET}`, SECRET)).toBe(true);
		for (const header of [null, '', 'Bearer wrong', SECRET, `bearer ${SECRET}`]) {
			expect(isWorkerBearer(header, SECRET), String(header)).toBe(false);
		}
		expect(isWorkerBearer('Bearer ', '')).toBe(false);
	});

	it('reads only https URLs on the R2 endpoint', () => {
		expect(isR2Url(R2_URL)).toBe(true);
		for (const url of [
			'http://acct.r2.cloudflarestorage.com/x',
			'https://example.com/x',
			'https://r2.cloudflarestorage.com.example.com/x',
			'not a url'
		]) {
			expect(isR2Url(url), url).toBe(false);
		}
	});
});

describe('master-verify-background', () => {
	/** Answers R2 GETs with `object`, and records the results posted back to LabelKit. */
	function storageAndSite(object: () => Response) {
		const posted: { url: string; headers: Headers; body: unknown }[] = [];
		const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
			const url = String(input);
			if (url.startsWith('https://acct.r2.cloudflarestorage.com/')) return object();
			posted.push({
				url,
				headers: new Headers(init?.headers),
				body: JSON.parse(String(init?.body))
			});
			return new Response('{}');
		}) as typeof fetch;
		return { posted, fetchImpl };
	}

	it('keeps its read deadline inside the 15-minute background limit', () => {
		expect(READ_DEADLINE_MS).toBeLessThan(15 * 60_000);
	});

	it('refuses a caller without the worker secret and reads nothing', async () => {
		const { posted, fetchImpl } = storageAndSite(() => new Response(WAV));
		const res = await background(bearer('wrong'), { fetchImpl });
		expect(res.status).toBe(401);
		expect(posted).toEqual([]);
	});

	it('reads the object and reports its hash, size and header to LabelKit', async () => {
		const { posted, fetchImpl } = storageAndSite(() => new Response(WAV));
		await background(bearer(), { fetchImpl });
		expect(posted).toHaveLength(1);
		expect(posted[0].url).toBe(`${SITE_URL}/api/internal/verify-masters`);
		expect(posted[0].headers.get('authorization')).toBe(`Bearer ${SECRET}`);
		expect(posted[0].headers.get('origin')).toBe(SITE_URL);
		expect(posted[0].body).toEqual({
			results: [
				{
					id: job.id,
					token: job.token,
					sha256: sha(WAV),
					size: WAV.length,
					header: Buffer.from(WAV.slice(0, 12)).toString('hex')
				}
			]
		});
	});

	it('reports a failed read as an error, so the master is retried', async () => {
		const { posted, fetchImpl } = storageAndSite(() => new Response('denied', { status: 403 }));
		await background(bearer(), { fetchImpl });
		expect(posted[0].body).toMatchObject({ results: [{ id: job.id, token: job.token }] });
		const [result] = (posted[0].body as { results: { error?: string; status?: number }[] }).results;
		expect(result.error).toMatch(/403/);
		// The storage status goes with it, so a missing object (404) can be rejected at once.
		expect(result.status).toBe(403);
	});

	it('will not read a URL that is not R2', async () => {
		const { posted, fetchImpl } = storageAndSite(() => new Response(WAV));
		const req = new Request(`${SITE_URL}/.netlify/functions/master-verify-background`, {
			method: 'POST',
			headers: { authorization: `Bearer ${SECRET}` },
			body: JSON.stringify({ jobs: [{ ...job, url: 'https://example.com/m.wav' }] })
		});
		await background(req, { fetchImpl });
		expect((posted[0].body as { results: { error?: string }[] }).results[0].error).toMatch(
			/not a storage URL/
		);
	});
});

describe('siteUrlFor', () => {
	const env = { URL: 'https://labelkit.co', SITE_NAME: 'labelkit' };
	const preview = new Request(
		'https://deploy-preview-87--labelkit.netlify.app/.netlify/functions/x'
	);

	it("uses a preview's own address, so a preview test never reaches production", () => {
		expect(siteUrlFor(preview, { deploy: { context: 'deploy-preview' } }, env)).toBe(
			'https://deploy-preview-87--labelkit.netlify.app'
		);
		expect(siteUrlFor(preview, { deploy: { context: 'branch-deploy' } }, env)).toBe(
			'https://deploy-preview-87--labelkit.netlify.app'
		);
	});

	it('uses the main address in production, or when the context is unknown', () => {
		expect(siteUrlFor(preview, { deploy: { context: 'production' } }, env)).toBe(env.URL);
		expect(siteUrlFor(preview, undefined, env)).toBe(env.URL);
		expect(siteUrlFor(undefined, { deploy: { context: 'deploy-preview' } }, env)).toBe(env.URL);
	});

	it("never sends the secret to a host that is not one of this site's deploys", () => {
		for (const url of [
			'https://deploy-preview-1--other-site.netlify.app/x',
			'https://labelkit.netlify.app.example.com/x',
			'http://deploy-preview-87--labelkit.netlify.app/x'
		]) {
			expect(
				siteUrlFor(new Request(url), { deploy: { context: 'deploy-preview' } }, env),
				url
			).toBe(env.URL);
		}
	});
});

describe('master-verify schedule', () => {
	it('runs every minute', () => {
		expect(config.schedule).toBe('* * * * *');
	});

	it('leases masters, then starts one background read for each', async () => {
		const calls: { url: string; headers: Headers; body: string }[] = [];
		const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
			calls.push({
				url: String(input),
				headers: new Headers(init?.headers),
				body: String(init?.body)
			});
			if (String(input).endsWith('/api/internal/verify-masters')) {
				return Response.json({
					jobs: [job, { ...job, id: '00000000-0000-7000-8000-000000000002' }]
				});
			}
			return new Response(null, { status: 202 });
		}) as typeof fetch;
		await schedule(new Request(SITE_URL), { fetchImpl });
		expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
			'/api/internal/verify-masters',
			'/.netlify/functions/master-verify-background',
			'/.netlify/functions/master-verify-background'
		]);
		for (const call of calls) {
			expect(call.headers.get('authorization')).toBe(`Bearer ${SECRET}`);
			expect(call.headers.get('origin')).toBe(SITE_URL);
		}
		expect(JSON.parse(calls[1].body)).toEqual({ jobs: [job] });
	});

	it('starts the background reads in parallel, so the run stays short', async () => {
		let inFlight = 0;
		let most = 0;
		const fetchImpl = (async (input: string | URL) => {
			if (String(input).endsWith('/api/internal/verify-masters')) {
				return Response.json({ jobs: [1, 2, 3].map((n) => ({ ...job, id: String(n) })) });
			}
			inFlight++;
			most = Math.max(most, inFlight);
			await new Promise((r) => setTimeout(r, 20));
			inFlight--;
			return new Response(null, { status: 202 });
		}) as typeof fetch;
		await schedule(new Request(SITE_URL), { fetchImpl });
		expect(most).toBe(3);
	});

	it('fails loudly when a background read could not be started', async () => {
		const fetchImpl = (async (input: string | URL) =>
			String(input).endsWith('/api/internal/verify-masters')
				? Response.json({ jobs: [job] })
				: new Response('no', { status: 500 })) as typeof fetch;
		await expect(schedule(new Request(SITE_URL), { fetchImpl })).rejects.toThrow(
			/could not be started/
		);
	});

	it('refuses to run without a configured worker secret', async () => {
		delete process.env.WORKER_SECRET;
		await expect(schedule(new Request(SITE_URL))).rejects.toThrow(/WORKER_SECRET/);
	});
});
