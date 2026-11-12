import { describe, expect, it, vi } from 'vitest';

const KEYS = [
	'AUDIOKIT_BASE_URL',
	'AUDIOKIT_API_KEY',
	'AUDIOKIT_WEBHOOK_SECRET',
	'AUDIOKIT_FALLBACK_ORG_IDS',
	'AUDIOKIT_CREDENTIALS_KEY'
] as const;
const env = vi.hoisted(() => ({}) as Record<string, string | undefined>);
vi.mock('$app/env/private', () => env);

async function load() {
	vi.resetModules();
	return (await import('./audiokit-env.js')).audiokitClientEnv;
}

describe('audiokitClientEnv', () => {
	it('is undefined when AUDIOKIT_BASE_URL is unset', async () => {
		for (const key of KEYS) env[key] = undefined;
		expect((await load())()).toBeUndefined();
	});

	it('carries the base URL, the fallback credentials and the credentials key', async () => {
		Object.assign(env, {
			AUDIOKIT_BASE_URL: 'https://api.audiokit.test',
			AUDIOKIT_API_KEY: 'ak_fallback',
			AUDIOKIT_WEBHOOK_SECRET: 'whsec_fallback',
			AUDIOKIT_FALLBACK_ORG_IDS: 'org-a,org-b',
			AUDIOKIT_CREDENTIALS_KEY: 'key-ring'
		});
		expect((await load())()).toEqual({
			baseUrl: 'https://api.audiokit.test',
			fallback: {
				apiKey: 'ak_fallback',
				webhookSecret: 'whsec_fallback',
				orgIds: 'org-a,org-b'
			},
			credentialsKey: 'key-ring'
		});
	});
});
