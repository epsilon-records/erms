import { sql } from 'drizzle-orm';
import { bucket, METRICS_ORIGIN, parseSample } from '#lib/app-metrics-contract.js';
import type { Scoped } from './db/scoped';
export const empty = (status: number) =>
	new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });
const forbidden = [
	'cookie',
	'authorization',
	'proxy-authorization',
	'referer',
	'baggage',
	'sentry-trace',
	'traceparent',
	'tracestate',
	'x-api-key',
	'x-user-id',
	'x-org-id',
	'x-forwarded-authorization'
];
/** One process-wide bucket, no user/IP keys. This does not cap platform HTTP costs. */
export function createReceiver(now = Date.now) {
	let tokens = 5,
		updated = now(),
		active = 0;
	return async (request: Request, run: Scoped, enabled: boolean, origin = METRICS_ORIGIN) => {
		if (request.method !== 'POST') return empty(405);
		if (!enabled) return empty(204);
		const time = now();
		tokens = Math.min(5, tokens + Math.max(0, time - updated) / 2000);
		updated = time;
		if (tokens < 1 || active >= 2) return empty(429);
		tokens--;
		const h = request.headers;
		if (new URL(request.url).search || request.url.includes('?')) return empty(400);
		if (
			h.get('origin') !== origin ||
			h.get('sec-fetch-site') !== 'same-origin' ||
			forbidden.some((key) => h.has(key)) ||
			[...h.keys()].some(
				(key) =>
					// AWS load balancers add this transport header; its value is never consumed,
					// persisted or forwarded. Browser W3C/Sentry tracing still fails closed.
					key !== 'x-amzn-trace-id' &&
					/^x-.*(?:auth|token|session|user|org|tenant|trace|baggage|api-key)/i.test(key)
			)
		)
			return empty(403);
		if (
			!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(h.get('content-type') ?? '') ||
			!['identity', null].includes(h.get('content-encoding'))
		)
			return empty(415);
		const length = h.get('content-length');
		if (length !== null && (!/^\d+$/.test(length) || Number(length) > 256)) return empty(413);
		active++;
		let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			reader = request.body?.getReader();
			if (!reader) return empty(400);
			const timeout = new Promise<never>((_, reject) => {
				timer = setTimeout(() => {
					void reader?.cancel().catch(() => {});
					reject(new Error('deadline'));
				}, 1000);
			});
			const read = async () => {
				const chunks: Uint8Array[] = [];
				let bytes = 0;
				while (true) {
					const { value, done } = await reader!.read();
					if (done) break;
					bytes += value.length;
					if (bytes > 256) return null;
					chunks.push(value);
				}
				const data = new Uint8Array(bytes);
				let offset = 0;
				for (const chunk of chunks) {
					data.set(chunk, offset);
					offset += chunk.length;
				}
				try {
					return new TextDecoder('utf-8', { fatal: true }).decode(data);
				} catch {
					return '';
				}
			};
			const text = await Promise.race([read(), timeout]);
			clearTimeout(timer);
			if (text === null) return empty(413);
			const sample = parseSample(text);
			if (!sample) return empty(400);
			const accepted = await run(async (tx) => {
				const rows = (await tx.execute(
					sql`select app_metrics.record(1::smallint, ${sample.metric === 'document_mount_ms' ? 1 : 2}::smallint, ${bucket(sample.ms)}::smallint) as accepted`
				)) as { accepted: boolean }[];
				return rows[0]?.accepted === true;
			});
			return empty(accepted ? 204 : 429);
		} catch {
			return empty(503);
		} finally {
			clearTimeout(timer);
			void reader?.cancel().catch(() => {});
			active--;
		}
	};
}
export const receive = createReceiver();
