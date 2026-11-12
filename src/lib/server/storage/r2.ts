import { AwsClient } from 'aws4fetch';

/**
 * Master file storage on Cloudflare R2 through its S3-compatible API (decision 0011).
 *
 * The browser uploads straight to R2 with presigned URLs; the server only signs URLs and makes
 * small control calls (start/complete a multipart upload, HEAD the object). The background check
 * reads each finished master once through a presigned GET (master-verify.ts). No file body passes
 * through a synchronous Netlify function.
 */
export interface MasterStorage {
	/**
	 * Presigned PUT for a single-request upload. It is signed with `If-None-Match: *`, which the
	 * browser must send (CREATE_ONCE_HEADERS): R2 then refuses any PUT once the object exists, so
	 * the URL cannot replace a file after it has been checked.
	 */
	presignPut(key: string, expiresIn: number): Promise<string>;
	/** Presigned GET for downloading an object. */
	presignGet(key: string, expiresIn: number): Promise<string>;
	/** Starts a multipart upload and returns its upload id. */
	createMultipart(key: string): Promise<string>;
	/** Presigned PUT for one part of a multipart upload. */
	presignPart(
		key: string,
		uploadId: string,
		partNumber: number,
		expiresIn: number
	): Promise<string>;
	completeMultipart(key: string, uploadId: string, parts: Part[]): Promise<void>;
	abortMultipart(key: string, uploadId: string): Promise<void>;
	/**
	 * Size of the stored object, or null if R2 answers 404. A HEAD has no body, so this 404 cannot
	 * tell a missing key from a missing bucket: use `isMissing` before treating it as gone.
	 */
	head(key: string): Promise<{ size: number } | null>;
	/**
	 * True only when R2 says the key does not exist (`NoSuchKey`). A missing or misnamed bucket
	 * (`NoSuchBucket`) or any other answer is not proof that the object is gone.
	 */
	isMissing(key: string): Promise<boolean>;
	/** Delete the object. Fails if the bucket is missing; a key that is already gone is fine. */
	remove(key: string): Promise<void>;
	/** Every key under `prefix` (ListObjectsV2, all pages). Fails if the bucket is missing. */
	list(prefix: string): Promise<string[]>;
}

/** Keys and the continuation token from one ListObjectsV2 page. */
export function parseListPage(xml: string): { keys: string[]; next: string | null } {
	const unescape = (v: string) =>
		v
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&apos;/g, "'")
			.replace(/&amp;/g, '&');
	const keys = [...xml.matchAll(/<Key>([^<]*)<\/Key>/g)].map((m) => unescape(m[1]));
	const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
	const token = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1];
	return { keys, next: truncated && token ? unescape(token) : null };
}

export type Part = { partNumber: number; etag: string };

/**
 * Sent with, and signed into, a single-request upload: R2 evaluates it atomically and answers 412
 * if the key already exists. Because it is a signed header, a PUT without it fails the signature.
 */
export const CREATE_ONCE_HEADERS = { 'If-None-Match': '*' } as const;

export type R2Config = {
	accountId: string;
	accessKeyId: string;
	secretAccessKey: string;
	bucket: string;
};

export class StorageError extends Error {}

/** The `<Code>` of an S3/R2 XML error document, if there is one. */
export function errorCode(xml: string): string | null {
	return /<Code>([^<]+)<\/Code>/.exec(xml)?.[1] ?? null;
}

const xmlEscape = (s: string) =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function createR2Storage(config: R2Config, fetchImpl: typeof fetch = fetch): MasterStorage {
	const client = new AwsClient({
		accessKeyId: config.accessKeyId,
		secretAccessKey: config.secretAccessKey,
		service: 's3',
		region: 'auto'
	});
	const base = `https://${config.accountId}.r2.cloudflarestorage.com/${encodeURIComponent(config.bucket)}`;
	const objectUrl = (key: string, query: Record<string, string> = {}) => {
		const url = new URL(`${base}/${key.split('/').map(encodeURIComponent).join('/')}`);
		for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
		return url;
	};

	async function presign(
		url: URL,
		method: 'GET' | 'PUT',
		expiresIn: number,
		headers?: Record<string, string>
	) {
		url.searchParams.set('X-Amz-Expires', String(expiresIn));
		const signed = await client.sign(url.toString(), { method, headers, aws: { signQuery: true } });
		return signed.url;
	}

	async function call(url: URL, init: RequestInit, what: string) {
		const req = await client.sign(url.toString(), init);
		const res = await fetchImpl(req);
		if (!res.ok && res.status !== 404) {
			throw new StorageError(`R2 ${what} failed with ${res.status}`);
		}
		return res;
	}

	return {
		presignPut: (key, expiresIn) => presign(objectUrl(key), 'PUT', expiresIn, CREATE_ONCE_HEADERS),

		presignGet: (key, expiresIn) => presign(objectUrl(key), 'GET', expiresIn),

		async createMultipart(key) {
			const res = await call(
				objectUrl(key, { uploads: '' }),
				{ method: 'POST', headers: { 'Content-Type': 'audio/wav' } },
				'create multipart upload'
			);
			const id = /<UploadId>([^<]+)<\/UploadId>/.exec(await res.text())?.[1];
			if (res.status === 404 || !id) throw new StorageError('R2 returned no upload id');
			return id;
		},

		presignPart: (key, uploadId, partNumber, expiresIn) =>
			presign(objectUrl(key, { partNumber: String(partNumber), uploadId }), 'PUT', expiresIn),

		async completeMultipart(key, uploadId, parts) {
			const body =
				'<CompleteMultipartUpload>' +
				parts
					.map(
						(p) =>
							`<Part><PartNumber>${p.partNumber}</PartNumber><ETag>${xmlEscape(p.etag)}</ETag></Part>`
					)
					.join('') +
				'</CompleteMultipartUpload>';
			const res = await call(
				objectUrl(key, { uploadId }),
				{ method: 'POST', body, headers: { 'Content-Type': 'application/xml' } },
				'complete multipart upload'
			);
			// S3 can answer 200 with an error document.
			if (res.status === 404 || /<Error>/.test(await res.text())) {
				throw new StorageError('R2 could not complete the multipart upload');
			}
		},

		async abortMultipart(key, uploadId) {
			await call(objectUrl(key, { uploadId }), { method: 'DELETE' }, 'abort multipart upload');
		},

		async head(key) {
			const res = await call(objectUrl(key), { method: 'HEAD' }, 'head');
			if (res.status === 404) return null;
			return { size: Number(res.headers.get('content-length')) };
		},

		async isMissing(key) {
			// GET one byte: unlike a HEAD, a 404 here carries the error code.
			const res = await call(
				objectUrl(key),
				{ method: 'GET', headers: { Range: 'bytes=0-0' } },
				'existence check'
			);
			if (res.status !== 404) {
				await res.body?.cancel().catch(() => {});
				return false;
			}
			return errorCode(await res.text()) === 'NoSuchKey';
		},

		async remove(key) {
			const res = await call(objectUrl(key), { method: 'DELETE' }, 'delete');
			// Deleting a missing key is fine; a missing bucket means the object was not deleted.
			if (res.status === 404) {
				const code = errorCode(await res.text());
				if (code !== 'NoSuchKey') throw new StorageError(`R2 delete failed: ${code ?? 'HTTP 404'}`);
			}
		},

		async list(prefix) {
			const keys: string[] = [];
			let token: string | null = null;
			do {
				const url = new URL(base);
				url.searchParams.set('list-type', '2');
				url.searchParams.set('prefix', prefix);
				if (token) url.searchParams.set('continuation-token', token);
				const res = await call(url, { method: 'GET' }, 'list');
				// A list 404 can only be a missing bucket: never report that as "no objects".
				if (res.status === 404) {
					throw new StorageError(`R2 list failed: ${errorCode(await res.text()) ?? 'HTTP 404'}`);
				}
				const page = parseListPage(await res.text());
				keys.push(...page.keys);
				token = page.next;
			} while (token);
			return keys;
		}
	};
}
