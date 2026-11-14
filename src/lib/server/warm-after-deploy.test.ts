import { describe, expect, it, vi } from 'vitest';
import {
	PARALLEL,
	PATH,
	hit,
	target,
	warm
} from '../../../netlify/plugins/warm-after-deploy/index.mjs';

const response = (status: number) =>
	({ status, arrayBuffer: async () => new ArrayBuffer(0) }) as unknown as Response;

describe('warm-after-deploy plugin', () => {
	it('only warms production deploys', () => {
		expect(target({ CONTEXT: 'production', URL: 'https://labelkit.co' })).toBe(
			'https://labelkit.co'
		);
		expect(target({ CONTEXT: 'deploy-preview', URL: 'https://labelkit.co' })).toBeNull();
		expect(target({ CONTEXT: 'branch-deploy', URL: 'https://labelkit.co' })).toBeNull();
		expect(target({ CONTEXT: 'production' })).toBeNull();
	});

	it('sends PARALLEL requests to the login page and reports each one', async () => {
		const fetch = vi.fn(async () => response(200));
		const lines = await warm('https://labelkit.co', { fetch, now: () => 0 });

		expect(fetch).toHaveBeenCalledTimes(PARALLEL);
		for (const call of fetch.mock.calls as unknown as [string, RequestInit][]) {
			expect(call[0]).toBe(`https://labelkit.co${PATH}`);
			expect(call[1].redirect).toBe('manual');
		}
		expect(lines).toHaveLength(PARALLEL);
		expect(lines[0]).toContain('200 in 0 ms');
	});

	it('never throws when a request fails', async () => {
		const fetch = vi.fn(async () => {
			throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
		});
		await expect(hit('https://labelkit.co/login', { fetch })).resolves.toMatchObject({
			error: 'TimeoutError'
		});
		const lines = await warm('https://labelkit.co', { fetch });
		expect(lines.every((l) => l.includes('TimeoutError'))).toBe(true);
	});
});
