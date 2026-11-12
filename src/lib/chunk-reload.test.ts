import { describe, expect, it, vi } from 'vitest';
import {
	RELOAD_GUARD_KEY,
	RELOAD_GUARD_MS,
	chunkReloadTarget,
	isChunkLoadError,
	reloadOnce
} from './chunk-reload.js';

const chunk = 'https://labelkit.co/_app/immutable/nodes/1.DQMpsirO.js';

function memoryStorage() {
	const items = new Map<string, string>();
	return {
		getItem: (key: string) => items.get(key) ?? null,
		setItem: (key: string, value: string) => void items.set(key, value)
	};
}

describe('isChunkLoadError', () => {
	it.each([
		`Failed to fetch dynamically imported module: ${chunk}`, // Chromium, as in LABELKIT-8
		`error loading dynamically imported module: ${chunk}`, // Firefox
		'Importing a module script failed.', // Safari
		'Unable to preload CSS for /_app/immutable/assets/0.CD4UWQ9_.css' // Vite
	])('recognises %s', (message) => {
		expect(isChunkLoadError(new TypeError(message))).toBe(true);
		expect(isChunkLoadError(message)).toBe(true);
		expect(isChunkLoadError({ message })).toBe(true);
	});

	it.each([new Error('Load failed'), new TypeError('Failed to fetch'), null, undefined, 42, {}])(
		'ignores %s',
		(error) => {
			expect(isChunkLoadError(error)).toBe(false);
		}
	);
});

describe('reloadOnce', () => {
	it('does one full load, then refuses another within the guard window', () => {
		const storage = memoryStorage();
		const assign = vi.fn();
		let now = 1_000_000;
		const deps = { storage, now: () => now, assign };

		expect(reloadOnce('https://labelkit.co/', deps)).toBe(true);
		expect(assign).toHaveBeenCalledExactlyOnceWith('https://labelkit.co/');
		expect(storage.getItem(RELOAD_GUARD_KEY)).toBe('1000000');

		// The fresh page fails the same way: no second load, so no loop.
		now += RELOAD_GUARD_MS - 1;
		expect(reloadOnce('https://labelkit.co/', deps)).toBe(false);
		expect(reloadOnce('https://labelkit.co/releases', deps)).toBe(false);
		expect(assign).toHaveBeenCalledTimes(1);

		// A later, unrelated failure in the same tab gets its own try.
		now += 1;
		expect(reloadOnce('https://labelkit.co/releases', deps)).toBe(true);
		expect(assign).toHaveBeenLastCalledWith('https://labelkit.co/releases');
	});

	it('treats a guard from the future (clock change) or garbage as no guard', () => {
		const storage = memoryStorage();
		const assign = vi.fn();
		storage.setItem(RELOAD_GUARD_KEY, String(5_000_000));
		expect(reloadOnce('/', { storage, now: () => 1_000_000, assign })).toBe(true);
		storage.setItem(RELOAD_GUARD_KEY, 'not a number');
		expect(reloadOnce('/', { storage, now: () => 9_000_000, assign })).toBe(true);
		expect(assign).toHaveBeenCalledTimes(2);
	});

	it('does nothing when there is no storage to hold the guard', () => {
		const assign = vi.fn();
		expect(reloadOnce('/', { storage: undefined, now: () => 1, assign })).toBe(false);
		const throwing = {
			getItem: () => {
				throw new Error('SecurityError');
			},
			setItem: () => {}
		};
		expect(reloadOnce('/', { storage: throwing, now: () => 1, assign })).toBe(false);
		const full = {
			getItem: () => null,
			setItem: () => {
				throw new Error('QuotaExceededError');
			}
		};
		expect(reloadOnce('/', { storage: full, now: () => 1, assign })).toBe(false);
		expect(assign).not.toHaveBeenCalled();
	});
});

describe('chunkReloadTarget', () => {
	const error = new TypeError(`Failed to fetch dynamically imported module: ${chunk}`);
	const base = {
		started: true,
		navigatingTo: null,
		errorUrl: 'https://labelkit.co/releases',
		currentUrl: 'https://labelkit.co/'
	};

	it('reloads the current page when start-up failed', () => {
		expect(chunkReloadTarget(error, { ...base, started: false })).toBe('https://labelkit.co/');
	});

	it('loads the destination when a navigation failed', () => {
		expect(
			chunkReloadTarget(error, { ...base, navigatingTo: 'https://labelkit.co/releases' })
		).toBe('https://labelkit.co/releases');
	});

	it('leaves a failed preload (hovered link) alone', () => {
		expect(chunkReloadTarget(error, base)).toBeNull();
		expect(chunkReloadTarget(error, { ...base, navigatingTo: 'https://labelkit.co/artists' })).toBe(
			null
		);
	});

	it('leaves every other error to the error page', () => {
		const other = new Error('Not found');
		expect(chunkReloadTarget(other, { ...base, started: false })).toBeNull();
		expect(chunkReloadTarget(other, { ...base, navigatingTo: base.errorUrl })).toBeNull();
	});
});
