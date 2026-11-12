// The client hook's chunk-load recovery (EPSILON-191), with SvelteKit's state and the browser faked.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RELOAD_GUARD_KEY } from '#lib/chunk-reload.js';

const state = vi.hoisted(() => ({
	page: { status: -1 },
	navigating: { to: null as { url: URL } | null },
	reported: [] as unknown[]
}));

vi.mock('$app/env/public', () => ({ PUBLIC_SENTRY_DSN: '' }));
vi.mock('$app/state', () => ({ page: state.page, navigating: state.navigating }));
vi.mock('@sentry/sveltekit', () => ({
	init: vi.fn(),
	browserTracingIntegration: vi.fn(() => ({ name: 'BrowserTracing' })),
	handleErrorWithSentry:
		(handler: (input: { error: unknown }) => unknown) => (input: { error: unknown }) => {
			state.reported.push(input.error);
			return handler(input);
		}
}));

const listeners = new Map<string, (event: { reason: unknown }) => void>();
const items = new Map<string, string>();
const assign = vi.fn();
const location = { href: 'https://labelkit.co/', assign };

vi.stubGlobal('__SENTRY_ENVIRONMENT__', 'test');
vi.stubGlobal('__SENTRY_RELEASE__', null);
vi.stubGlobal('location', location);
vi.stubGlobal('window', {
	addEventListener: (type: string, fn: (event: { reason: unknown }) => void) =>
		listeners.set(type, fn),
	sessionStorage: {
		getItem: (key: string) => items.get(key) ?? null,
		setItem: (key: string, value: string) => void items.set(key, value)
	}
});

const { handleError } = await import('./hooks.client.js');

afterAll(() => vi.unstubAllGlobals());

const chunkError = () =>
	new TypeError(
		'Failed to fetch dynamically imported module: https://labelkit.co/_app/immutable/nodes/1.DQMpsirO.js'
	);
const input = (error: unknown, href: string) =>
	({
		error,
		event: { url: new URL(href) },
		status: 500,
		message: 'Internal Error'
	}) as never;

beforeEach(() => {
	items.clear();
	assign.mockClear();
	state.reported.length = 0;
	state.page.status = -1;
	state.navigating.to = null;
});

describe('start-up (LABELKIT-8)', () => {
	it('reloads once when the root chunks fail to import, then stops', () => {
		const rejected = listeners.get('unhandledrejection');
		expect(rejected).toBeDefined();
		rejected!({ reason: chunkError() });
		expect(assign).toHaveBeenCalledExactlyOnceWith('https://labelkit.co/');
		expect(items.get(RELOAD_GUARD_KEY)).toBeDefined();

		// The reloaded page fails too: the guard holds.
		rejected!({ reason: chunkError() });
		expect(assign).toHaveBeenCalledTimes(1);
	});

	it('ignores unrelated rejections and rejections after start-up', () => {
		const rejected = listeners.get('unhandledrejection')!;
		rejected({ reason: new Error('boom') });
		state.page.status = 200;
		rejected({ reason: chunkError() });
		expect(assign).not.toHaveBeenCalled();
	});

	it('reloads when hydration fails on a chunk, and still reports to Sentry', async () => {
		const error = chunkError();
		await handleError(input(error, 'https://labelkit.co/'));
		expect(assign).toHaveBeenCalledExactlyOnceWith('https://labelkit.co/');
		expect(state.reported).toEqual([error]);
	});
});

describe('after start-up', () => {
	beforeEach(() => {
		state.page.status = 200;
	});

	it('does a full load of the destination when a navigation fails on a chunk', async () => {
		state.navigating.to = { url: new URL('https://labelkit.co/releases') };
		await handleError(input(chunkError(), 'https://labelkit.co/releases'));
		expect(assign).toHaveBeenCalledExactlyOnceWith('https://labelkit.co/releases');
	});

	it('does nothing for a failed preload of a hovered link', async () => {
		await handleError(input(chunkError(), 'https://labelkit.co/artists'));
		expect(assign).not.toHaveBeenCalled();
		expect(state.reported).toHaveLength(1);
	});

	it('does nothing for other errors', async () => {
		state.navigating.to = { url: new URL('https://labelkit.co/releases') };
		await handleError(input(new Error('Not found'), 'https://labelkit.co/releases'));
		expect(assign).not.toHaveBeenCalled();
	});
});
