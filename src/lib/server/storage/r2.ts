import { AwsClient } from 'aws4fetch';

/**
 * Master file storage on Cloudflare R2 through its S3-compatible API (decision 0011).
 *
 * The browser uploads straight to R2 with presigned URLs; the server only signs URLs
 * and makes small control calls (start/complete a multipart upload, HEAD the object,
 * read its first bytes). No file body passes through a Netlify function.
 */
export interface MasterStorage {
	/** Presigned PUT for a single-request upload. */
	presignPut(key: string, expiresIn: number): Promise<string>;
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
	/** Size of the stored object, or null if there is none. */
	head(key: string): Promise<{ size: number } | null>;
	/** The first `length` bytes of the object. */
	readStart(key: string, length: number): Promise<Uint8Array>;
	remove(key: string): Promise<void>;
}

export type Part = { partNumber: number; etag: string };

export type R2Config = {
	accountId: string;
	accessKeyId: string;
	secretAccessKey: string;
	bucket: string;
};

export class StorageError extends Error {}

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

	async function presign(url: URL, expiresIn: number) {
		url.searchParams.set('X-Amz-Expires', String(expiresIn));
		const signed = await client.sign(url.toString(), { method: 'PUT', aws: { signQuery: true } });
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
		presignPut: (key, expiresIn) => presign(objectUrl(key), expiresIn),

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
			presign(objectUrl(key, { partNumber: String(partNumber), uploadId }), expiresIn),

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

		async readStart(key, length) {
			const res = await call(
				objectUrl(key),
				{ method: 'GET', headers: { Range: `bytes=0-${length - 1}` } },
				'read'
			);
			if (res.status === 404) return new Uint8Array();
			return new Uint8Array(await res.arrayBuffer()).slice(0, length);
		},

		async remove(key) {
			await call(objectUrl(key), { method: 'DELETE' }, 'delete');
		}
	};
}
