import { describe, expect, it, vi } from 'vitest';
import { AudioKitClient } from './client';
import { AudioProviderError } from './provider';

function limitedClient(retryAfter?: string, status = 429) {
	const fetchImpl = vi
		.fn<typeof fetch>()
		.mockResolvedValue(
			Response.json(
				{ error: { code: 'rate_limited', message: 'Too much traffic' } },
				{ status, headers: retryAfter === undefined ? {} : { 'Retry-After': retryAfter } }
			)
		);
	return {
		client: new AudioKitClient('https://api.example', 'test-key', 'test-secret', fetchImpl),
		fetchImpl
	};
}

describe('AudioKit rate-limit responses', () => {
	it.each(['capabilities', 'submit', 'status', 'cancel'] as const)(
		'%s preserves the code and delay without retrying',
		async (method) => {
			const { client, fetchImpl } = limitedClient('3');
			const request =
				method === 'submit'
					? client.submit({
							job_id: 'test-job',
							operation: 'probe',
							input: { url: 'https://input.example/audio.wav', sha256: 'a'.repeat(64) }
						})
					: method === 'capabilities'
						? client.capabilities()
						: client[method]('test-provider-job');
			await expect(request).rejects.toBeInstanceOf(AudioProviderError);
			await expect(request).rejects.toMatchObject({
				code: 'rate_limited',
				message: 'Too much traffic',
				retryAfterSeconds: 3
			});
			expect(fetchImpl).toHaveBeenCalledTimes(1);
		}
	);

	it.each([
		undefined,
		'0',
		'-1',
		'1.5',
		'1e2',
		'Infinity',
		'9007199254740992',
		'Wed, 21 Oct 2015 07:28:00 GMT'
	])('ignores an absent or invalid delay (%s)', async (header) => {
		const { client } = limitedClient(header);
		await expect(client.capabilities()).rejects.toMatchObject({
			code: 'rate_limited',
			retryAfterSeconds: undefined
		});
	});

	it('preserves the minimum delay of one second', async () => {
		const { client } = limitedClient('1');
		await expect(client.capabilities()).rejects.toMatchObject({ retryAfterSeconds: 1 });
	});

	it('does not attach a rate-limit delay to other failures', async () => {
		const { client } = limitedClient('3', 503);
		await expect(client.capabilities()).rejects.toMatchObject({ retryAfterSeconds: undefined });
	});
});
