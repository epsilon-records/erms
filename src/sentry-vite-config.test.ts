import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConfigEnv, Plugin, PluginOption, UserConfig } from 'vite';

// Sentry ERMS-1: `@sentry/sveltekit`'s browser tracing imports `@sentry/sveltekit/browser-tracing-variant`,
// which by default resolves to the `$app/stores` module. On SvelteKit 3 that throws
// `app_stores_removed` on every page load. Only the plugin below redirects it to the `$app/state`
// module, so it must be registered on every build, not only when SENTRY_AUTH_TOKEN is set.
const VARIANT_RESOLVER = 'sentry-sveltekit-browser-tracing-variant';

async function resolveConfig(): Promise<UserConfig> {
	vi.resetModules();
	const { default: config } = await import('../vite.config');
	const env: ConfigEnv = { command: 'build', mode: 'production' };
	return (await (typeof config === 'function' ? config(env) : config)) as UserConfig;
}

async function pluginNames(): Promise<string[]> {
	const resolved = await resolveConfig();
	const flat = (resolved.plugins ?? []).flat(Infinity as 1) as PluginOption[];
	return flat
		.filter((p): p is Plugin => !!p && typeof p === 'object' && 'name' in p)
		.map((p) => p.name);
}

describe('vite config: Sentry browser tracing variant (ERMS-1)', () => {
	afterEach(() => vi.unstubAllEnvs());

	it('registers the Kit 3 variant resolver without SENTRY_AUTH_TOKEN (Netlify builds)', async () => {
		vi.stubEnv('SENTRY_AUTH_TOKEN', '');
		expect(await pluginNames()).toContain(VARIANT_RESOLVER);
	});

	it('registers it with SENTRY_AUTH_TOKEN too (CI release builds)', async () => {
		vi.stubEnv('SENTRY_AUTH_TOKEN', 'placeholder-not-a-token');
		expect(await pluginNames()).toContain(VARIANT_RESOLVER);
	});
});

// Both hooks read these, so browser and server events carry the same environment and release,
// and a deploy preview (Netlify CONTEXT=deploy-preview) is not reported as production.
describe('vite config: Sentry environment and release', () => {
	afterEach(() => vi.unstubAllEnvs());

	it('takes them from Netlify build variables', async () => {
		vi.stubEnv('CONTEXT', 'deploy-preview');
		vi.stubEnv('COMMIT_REF', 'abc123');
		expect((await resolveConfig()).define).toMatchObject({
			__SENTRY_ENVIRONMENT__: '"deploy-preview"',
			__SENTRY_RELEASE__: '"abc123"'
		});
	});

	it('falls back to development with no release outside Netlify', async () => {
		vi.stubEnv('CONTEXT', undefined);
		vi.stubEnv('COMMIT_REF', undefined);
		expect((await resolveConfig()).define).toMatchObject({
			__SENTRY_ENVIRONMENT__: '"development"',
			__SENTRY_RELEASE__: 'null'
		});
	});
});
