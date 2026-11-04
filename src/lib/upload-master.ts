import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { isWavHeader, PART_SIZE, WAV_HEADER_BYTES, wavProblem } from './masters';

/**
 * Browser side of a master upload. The file goes straight to R2 with presigned URLs from
 * ERMS; ERMS only sees small JSON requests. SHA-256 is computed here in slices, alongside
 * the upload, so a multi-GB WAV is never held in memory at once.
 */

export type Progress = { phase: 'uploading' | 'finishing'; sent: number; total: number };

const HASH_SLICE = 8 * 1024 * 1024;
const CONCURRENCY = 3;
const SIGN_BATCH = 16;

export class UploadError extends Error {}

async function postJson<T>(path: string, body: unknown = {}): Promise<T> {
	const res = await fetch(path, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new UploadError(data.message ?? `Request failed (${res.status})`);
	return data as T;
}

async function hashFile(file: Blob, signal: AbortSignal) {
	const h = sha256.create();
	for (let at = 0; at < file.size; at += HASH_SLICE) {
		if (signal.aborted) throw new UploadError('Cancelled');
		h.update(new Uint8Array(await file.slice(at, at + HASH_SLICE).arrayBuffer()));
	}
	return bytesToHex(h.digest());
}

/** PUT a body to a presigned URL with progress; resolves to the ETag R2 returns. */
function put(
	url: string,
	body: Blob,
	onSent: (n: number) => void,
	signal: AbortSignal,
	contentType?: string
) {
	return new Promise<string>((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open('PUT', url);
		if (contentType) xhr.setRequestHeader('Content-Type', contentType);
		xhr.upload.onprogress = (e) => onSent(e.loaded);
		xhr.onload = () => {
			if (xhr.status < 200 || xhr.status >= 300) {
				return reject(new UploadError(`Storage refused the upload (${xhr.status})`));
			}
			onSent(body.size);
			resolve(xhr.getResponseHeader('ETag') ?? '');
		};
		xhr.onerror = () => reject(new UploadError('Network error while uploading'));
		xhr.onabort = () => reject(new UploadError('Cancelled'));
		signal.addEventListener('abort', () => xhr.abort(), { once: true });
		xhr.send(body);
	});
}

type Start =
	| { masterId: string; mode: 'single'; url: string }
	| { masterId: string; mode: 'multipart'; partSize: number; partCount: number };

export type Finished =
	{ status: 'ready'; masterId: string } | { status: 'rejected'; reason: string };

export async function uploadMaster(
	recordingId: string,
	file: File,
	onProgress: (p: Progress) => void,
	signal: AbortSignal
): Promise<Finished> {
	const problem = wavProblem(file);
	if (problem) throw new UploadError(problem);
	if (!isWavHeader(new Uint8Array(await file.slice(0, WAV_HEADER_BYTES).arrayBuffer()))) {
		throw new UploadError('This file does not have a WAV header.');
	}

	const base = `/recordings/${recordingId}/masters`;
	const start = await postJson<Start>(base, {
		fileName: file.name,
		size: file.size,
		contentType: file.type
	});
	const at = `${base}/${start.masterId}`;
	const sent = new Map<number, number>();
	const report = () =>
		onProgress({
			phase: 'uploading',
			sent: [...sent.values()].reduce((a, b) => a + b, 0),
			total: file.size
		});

	try {
		const hashing = hashFile(file, signal);
		let parts: { partNumber: number; etag: string }[] | undefined;

		if (start.mode === 'single') {
			await put(
				start.url,
				file,
				(n) => (sent.set(1, n), report()),
				signal,
				file.type || 'audio/wav'
			);
		} else {
			parts = await uploadParts(at, file, start.partCount, start.partSize, sent, report, signal);
		}

		const sha = await hashing;
		onProgress({ phase: 'finishing', sent: file.size, total: file.size });
		return await postJson<Finished>(`${at}/complete`, { sha256: sha, parts });
	} catch (e) {
		// Best effort: drop the pending upload so R2 doesn't keep half a file.
		await postJson(`${at}/abort`).catch(() => {});
		throw e;
	}
}

async function uploadParts(
	at: string,
	file: File,
	count: number,
	partSize: number,
	sent: Map<number, number>,
	report: () => void,
	signal: AbortSignal
) {
	if (partSize !== PART_SIZE) throw new UploadError('Server and browser disagree on part size.');
	const urls = new Map<number, Promise<string>>();
	const urlFor = (n: number) => {
		if (!urls.has(n)) {
			const batch: number[] = [];
			for (let i = n; i <= count && batch.length < SIGN_BATCH; i++) if (!urls.has(i)) batch.push(i);
			const signed = postJson<{ parts: { partNumber: number; url: string }[] }>(`${at}/parts`, {
				partNumbers: batch
			});
			for (const i of batch) {
				urls.set(
					i,
					signed.then((r) => r.parts.find((p) => p.partNumber === i)!.url)
				);
			}
		}
		return urls.get(n)!;
	};

	const etags: { partNumber: number; etag: string }[] = [];
	let next = 1;
	const worker = async () => {
		while (next <= count) {
			const n = next++;
			const body = file.slice((n - 1) * partSize, n * partSize);
			const etag = await put(await urlFor(n), body, (b) => (sent.set(n, b), report()), signal);
			if (!etag) throw new UploadError('Storage did not return an ETag (check the bucket CORS).');
			etags.push({ partNumber: n, etag });
		}
	};
	await Promise.all(Array.from({ length: Math.min(CONCURRENCY, count) }, worker));
	return etags.sort((a, b) => a.partNumber - b.partNumber);
}
