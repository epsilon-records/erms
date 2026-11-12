import { describe, expect, it } from 'vitest';
import { createR2Storage, parseListPage } from './r2';

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

	it('signs a single PUT as create-once, so it cannot replace a stored file', async () => {
		const url = new URL(await createR2Storage(config).presignPut(key, 900));
		// R2 answers 412 to a PUT with If-None-Match: * once the key exists. The header is signed,
		// so a PUT that leaves it out fails the signature instead.
		expect(url.searchParams.get('X-Amz-SignedHeaders')?.split(';')).toContain('if-none-match');
		expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
	});

	it('does not make GET URLs conditional', async () => {
		const url = new URL(await createR2Storage(config).presignGet(key, 900));
		expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
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

	it('HEADs an object for its size', async () => {
		const { calls, fetchImpl } = recorder(
			() => new Response(null, { headers: { 'content-length': '1234' } })
		);
		expect(await createR2Storage(config, fetchImpl).head(key)).toEqual({ size: 1234 });
		expect(calls.map((c) => c.method)).toEqual(['HEAD']);
	});

	it('says a key is missing only when R2 answers NoSuchKey', async () => {
		const answer = (status: number, code?: string) =>
			recorder(() =>
				code
					? new Response(`<Error><Code>${code}</Code></Error>`, { status })
					: new Response(new Uint8Array([82]), { status })
			).fetchImpl;
		expect(await createR2Storage(config, answer(404, 'NoSuchKey')).isMissing(key)).toBe(true);
		// A wrong bucket name is not proof that the object is gone.
		expect(await createR2Storage(config, answer(404, 'NoSuchBucket')).isMissing(key)).toBe(false);
		expect(await createR2Storage(config, answer(206)).isMissing(key)).toBe(false);
		const { calls, fetchImpl } = recorder(
			() => new Response(new Uint8Array([82]), { status: 206 })
		);
		await createR2Storage(config, fetchImpl).isMissing(key);
		expect(calls[0].method).toBe('GET');
		expect(calls[0].headers.get('range')).toBe('bytes=0-0');
	});

	it('fails a delete or list against a missing bucket, but not a delete of a missing key', async () => {
		const answer = (code: string) =>
			recorder(() => new Response(`<Error><Code>${code}</Code></Error>`, { status: 404 }))
				.fetchImpl;
		await expect(createR2Storage(config, answer('NoSuchBucket')).remove(key)).rejects.toThrow(
			/NoSuchBucket/
		);
		await expect(createR2Storage(config, answer('NoSuchKey')).remove(key)).resolves.toBeUndefined();
		const gone = recorder(() => new Response(null, { status: 204 })).fetchImpl;
		await expect(createR2Storage(config, gone).remove(key)).resolves.toBeUndefined();
		await expect(createR2Storage(config, answer('NoSuchBucket')).list('orgs/a/')).rejects.toThrow(
			/NoSuchBucket/
		);
	});

	it('returns null for a missing object', async () => {
		const { fetchImpl } = recorder(() => new Response(null, { status: 404 }));
		expect(await createR2Storage(config, fetchImpl).head(key)).toBeNull();
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
