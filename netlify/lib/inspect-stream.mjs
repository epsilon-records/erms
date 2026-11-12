import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * One streamed read of a stored master (EPSILON-120): its SHA-256, its size and its first
 * `headerBytes` bytes, without holding the body in memory. Shared by the background verifier
 * (netlify/functions/master-verify-background.mjs) and the one-off re-check script.
 *
 * With `signal`, an abort stops the read at once, even one waiting on a stalled body, and the
 * call throws: a cut-off read never yields a hash.
 *
 * @param {ReadableStream<Uint8Array>} body
 * @param {number} headerBytes
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ sha256: string; size: number; start: Uint8Array }>}
 */
export async function inspectStream(body, headerBytes, signal) {
	const hash = createHash('sha256');
	const start = new Uint8Array(headerBytes);
	let size = 0;
	const reader = body.getReader();
	const stop = () => reader.cancel(signal?.reason).catch(() => {});
	signal?.addEventListener('abort', stop, { once: true });
	try {
		for (;;) {
			signal?.throwIfAborted();
			const { done, value } = await reader.read();
			// A cancel ends the stream as if it were done; that is a failure, not the end of the file.
			signal?.throwIfAborted();
			if (done) break;
			hash.update(value);
			if (size < headerBytes) start.set(value.subarray(0, headerBytes - size), size);
			size += value.length;
		}
	} catch (e) {
		// A stalled or broken read: stop the transfer, then fail.
		await reader.cancel().catch(() => {});
		throw e;
	} finally {
		signal?.removeEventListener('abort', stop);
		reader.releaseLock();
	}
	return { sha256: hash.digest('hex'), size, start: start.slice(0, Math.min(size, headerBytes)) };
}

/**
 * GET `url` and inspect the body, giving up after `deadlineMs` in all (connect, headers and
 * every byte). A timeout or a non-2xx answer throws (with `status` for the latter); the caller
 * reports it, and the master is retried or, in the end, rejected. It is never trusted.
 *
 * @param {string} url
 * @param {{ deadlineMs: number; headerBytes: number; fetchImpl?: typeof fetch }} options
 */
export async function inspectUrl(url, { deadlineMs, headerBytes, fetchImpl = fetch }) {
	const signal = AbortSignal.timeout(deadlineMs);
	const res = await fetchImpl(url, { signal });
	if (!res.ok || !res.body) {
		await res.body?.cancel().catch(() => {});
		// `status` lets the caller tell a missing object (404, final) from a passing failure.
		throw Object.assign(new Error(`storage answered HTTP ${res.status}`), { status: res.status });
	}
	return inspectStream(res.body, headerBytes, signal);
}

/**
 * The same check as src/lib/server/worker-auth.ts, for the Netlify functions, which cannot
 * import TypeScript: `Authorization: Bearer <WORKER_SECRET>`, compared in constant time.
 *
 * @param {string | null} header
 * @param {string | undefined} secret
 */
export function isWorkerBearer(header, secret) {
	if (!secret) return false;
	const digest = (/** @type {string} */ v) => createHash('sha256').update(v).digest();
	return timingSafeEqual(digest(header ?? ''), digest(`Bearer ${secret}`));
}

/** Presigned R2 URLs only: https, on the R2 S3 endpoint. */
export function isR2Url(/** @type {string} */ value) {
	try {
		const url = new URL(value);
		return url.protocol === 'https:' && url.hostname.endsWith('.r2.cloudflarestorage.com');
	} catch {
		return false;
	}
}

/** Bytes to lowercase hex. */
export const toHex = (/** @type {Uint8Array} */ bytes) => Buffer.from(bytes).toString('hex');
