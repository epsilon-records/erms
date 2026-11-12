import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createR2Storage, inspectStream, parseListPage } from './r2';

const config = {
	accountId: 'acct123',
	accessKeyId: 'test-key-id',
	secretAccessKey: 'test-secret',
	bucket: 'masters'
};
const key = 'orgs/o/recordings/r/masters/m.wav';

function recorder(respond: (req: Request) => Response) {
	const calls: Request[] = [];
	const fetchImpl = (async (input: RequestInfo | URL) => {
		const req = input instanceof Request ? input : new Request(input);
		calls.push(req);
		return respond(req);
	}) as typeof fetch;
	return { calls, fetchImpl };
}

describe('R2 storage', () => {
	it('presigns a short-lived PUT for the exact object key', async () => {
		const r2 = createR2Storage(config);
		const url = new URL(await r2.presignPut(key, 900));
		expect(url.origin).toBe('https://acct123.r2.cloudflarestorage.com');
		expect(url.pathname).toBe(`/masters/${key}`);
		expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
		expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
		expect(url.searchParams.get('X-Amz-Credential')).toContain('/auto/s3/aws4_request');
		expect(url.toString()).not.toContain('test-secret');
	});

	it('presigns parts with the upload id and part number', async () => {
		const url = new URL(await createR2Storage(config).presignPart(key, 'up-1', 3, 900));
		expect(url.searchParams.get('partNumber')).toBe('3');
		expect(url.searchParams.get('uploadId')).toBe('up-1');
	});

	it('starts and completes a multipart upload', async () => {
		const { calls, fetchImpl } = recorder((req) =>
			req.url.includes('uploads')
				? new Response(
						'<InitiateMultipartUploadResult><UploadId>abc</UploadId></InitiateMultipartUploadResult>'
					)
				: new Response('<CompleteMultipartUploadResult/>')
		);
		const r2 = createR2Storage(config, fetchImpl);
		expect(await r2.createMultipart(key)).toBe('abc');
		await r2.completeMultipart(key, 'abc', [{ partNumber: 1, etag: '"e1"' }]);
		expect(calls.map((c) => c.method)).toEqual(['POST', 'POST']);
		expect(await calls[1].text()).toBe(
			'<CompleteMultipartUpload><Part><PartNumber>1</PartNumber><ETag>"e1"</ETag></Part></CompleteMultipartUpload>'
		);
		expect(calls[1].headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 /);
	});

	it('treats an error document on complete as a failure', async () => {
		const { fetchImpl } = recorder(() => new Response('<Error><Code>InvalidPart</Code></Error>'));
		await expect(
			createR2Storage(config, fetchImpl).completeMultipart(key, 'abc', [])
		).rejects.toThrow();
	});

	it('HEADs, then reads the whole object once to hash it', async () => {
		const body = new TextEncoder().encode('RIFF\x24\x00\x00\x00WAVEfmt and the rest of the file');
		const { calls, fetchImpl } = recorder((req) =>
			req.method === 'HEAD'
				? new Response(null, { headers: { 'content-length': String(body.length) } })
				: new Response(body)
		);
		const r2 = createR2Storage(config, fetchImpl);
		expect(await r2.head(key)).toEqual({ size: body.length });
		expect(await r2.inspect(key, 12)).toEqual({
			sha256: createHash('sha256').update(body).digest('hex'),
			size: body.length,
			start: body.slice(0, 12)
		});
		expect(calls.map((c) => c.method)).toEqual(['HEAD', 'GET']);
		expect(calls[1].headers.get('range')).toBeNull();
	});

	it('hashes a stream that arrives in small chunks', async () => {
		const bytes = new Uint8Array(1000).map((_, i) => i % 251);
		const stream = new ReadableStream<Uint8Array>({
			start(c) {
				for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7));
				c.close();
			}
		});
		expect(await inspectStream(stream, 12)).toEqual({
			sha256: createHash('sha256').update(bytes).digest('hex'),
			size: 1000,
			start: bytes.slice(0, 12)
		});
		const tiny = new ReadableStream<Uint8Array>({
			start(c) {
				c.enqueue(new Uint8Array([1, 2]));
				c.close();
			}
		});
		expect((await inspectStream(tiny, 12)).start).toEqual(new Uint8Array([1, 2]));
	});

	it('returns null for a missing object', async () => {
		const { fetchImpl } = recorder(() => new Response(null, { status: 404 }));
		expect(await createR2Storage(config, fetchImpl).head(key)).toBeNull();
		expect(await createR2Storage(config, fetchImpl).inspect(key, 12)).toBeNull();
	});
});

describe('parseListPage', () => {
	it('reads keys and the continuation token of a truncated page', () => {
		const xml =
			'<ListBucketResult><IsTruncated>true</IsTruncated><Contents><Key>orgs/a/x.wav</Key></Contents>' +
			'<Contents><Key>orgs/a/b&amp;c</Key></Contents><NextContinuationToken>t1</NextContinuationToken></ListBucketResult>';
		expect(parseListPage(xml)).toEqual({ keys: ['orgs/a/x.wav', 'orgs/a/b&c'], next: 't1' });
	});
	it('stops on the last page', () => {
		expect(
			parseListPage('<ListBucketResult><IsTruncated>false</IsTruncated></ListBucketResult>')
		).toEqual({
			keys: [],
			next: null
		});
	});
});
