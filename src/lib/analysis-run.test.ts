import type { SubmitFunction } from '$app/forms';
import { describe, expect, it, vi } from 'vitest';
import { createRunTracker, runSubmit, startingAnnouncement } from './analysis-run.js';

// These test the pending-state logic behind RecordingAnalysis. The repo has no DOM test
// environment (vitest runs in node, components are only server-rendered), so the click
// itself is not simulated; the callbacks `use:enhance` calls are driven directly.

function setup() {
	const changes: string[][] = [];
	const tracker = createRunTracker((pending) => changes.push([...pending].sort()));
	return { tracker, changes };
}

type Callback = (opts: { update: () => Promise<void> }) => Promise<void>;
async function start(submit: SubmitFunction) {
	const cancel = vi.fn();
	const callback = (await submit({ cancel } as unknown as Parameters<SubmitFunction>[0])) as
		Callback | undefined;
	return { cancel, callback };
}

describe('analysis run tracker', () => {
	it('marks only the pressed card as starting', () => {
		const { tracker, changes } = setup();
		expect(tracker.begin('loudness')).toBe(true);
		expect(tracker.has('loudness')).toBe(true);
		expect(tracker.has('tempo')).toBe(false);
		expect(changes).toEqual([['loudness']]);
	});

	it('refuses a second begin on the same card, and allows another card', () => {
		const { tracker } = setup();
		expect(tracker.begin('loudness')).toBe(true);
		expect(tracker.begin('loudness')).toBe(false);
		expect(tracker.begin('tempo')).toBe(true);
	});

	it('names the operation in the announcement', () => {
		expect(startingAnnouncement('loudness')).toBe('Starting loudness analysis');
	});
});

describe('analysis run submit', () => {
	it('cancels a double submit without touching the first run', async () => {
		const { tracker } = setup();
		const submit = runSubmit(tracker, 'loudness');
		const first = await start(submit);
		expect(first.cancel).not.toHaveBeenCalled();
		const second = await start(submit);
		expect(second.cancel).toHaveBeenCalledOnce();
		expect(second.callback).toBeUndefined();
		expect(tracker.has('loudness')).toBe(true);
	});

	it('shows the starting state until the action returns, then calls update() and clears it', async () => {
		const { tracker, changes } = setup();
		let finish!: () => void;
		const update = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
		const { callback } = await start(runSubmit(tracker, 'key'));
		expect(tracker.has('key')).toBe(true);
		const done = callback!({ update });
		expect(update).toHaveBeenCalledOnce();
		expect(tracker.has('key')).toBe(true);
		finish();
		await done;
		expect(tracker.has('key')).toBe(false);
		expect(changes).toEqual([['key'], []]);
	});

	it.each([
		['a failure or redirect that update() resolves', () => Promise.resolve()],
		['an error thrown from update()', () => Promise.reject(new Error('boom'))]
	])('clears the state after %s, and the card can run again', async (_name, update) => {
		const { tracker } = setup();
		const { callback } = await start(runSubmit(tracker, 'tags'));
		await callback!({ update }).catch(() => {});
		expect(tracker.has('tags')).toBe(false);
		expect(tracker.begin('tags')).toBe(true);
	});

	it('leaves other cards untouched when one finishes', async () => {
		const { tracker } = setup();
		await start(runSubmit(tracker, 'tempo'));
		const { callback } = await start(runSubmit(tracker, 'key'));
		await callback!({ update: async () => {} });
		expect(tracker.has('key')).toBe(false);
		expect(tracker.has('tempo')).toBe(true);
	});
});
