import { describe, expect, it } from 'vitest';
import { createR2Storage } from './r2';

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

	it('HEADs and reads only the first bytes', async () => {
		const { calls, fetchImpl } = recorder((req) =>
			req.method === 'HEAD'
				? new Response(null, { headers: { 'content-length': '1234' } })
				: new Response(new Uint8Array([82, 73, 70, 70]), { status: 206 })
		);
		const r2 = createR2Storage(config, fetchImpl);
		expect(await r2.head(key)).toEqual({ size: 1234 });
		expect(await r2.readStart(key, 4)).toEqual(new Uint8Array([82, 73, 70, 70]));
		expect(calls[1].headers.get('range')).toBe('bytes=0-3');
	});

	it('returns null for a missing object', async () => {
		const { fetchImpl } = recorder(() => new Response(null, { status: 404 }));
		expect(await createR2Storage(config, fetchImpl).head(key)).toBeNull();
	});
});
