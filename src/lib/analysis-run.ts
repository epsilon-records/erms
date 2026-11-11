import type { SubmitFunction } from '$app/forms';

/**
 * Client-side pending state for the Analysis Run / Re-run buttons (EPSILON-144).
 *
 * The server action waits on AudioKit, so without this the page looks frozen until it returns.
 * The logic lives here, apart from the component, so it can be tested without a DOM. It only
 * enhances: without JavaScript the form still posts normally.
 */

/** Wording shared by the button, the card and the live region. */
export const STARTING_LABEL = 'Starting…';
export const startingAnnouncement = (operation: string) => `Starting ${operation} analysis`;

/** Which cards have a run in flight, by card key. Each card is tracked on its own. */
export type RunTracker = {
	has(key: string): boolean;
	/** Marks the card as starting. False when it already was: the caller must not submit. */
	begin(key: string): boolean;
	end(key: string): void;
};

export function createRunTracker(onChange: (pending: ReadonlySet<string>) => void): RunTracker {
	const pending = new Set<string>();
	return {
		has: (key) => pending.has(key),
		begin(key) {
			if (pending.has(key)) return false;
			pending.add(key);
			onChange(new Set(pending));
			return true;
		},
		end(key) {
			if (pending.delete(key)) onChange(new Set(pending));
		}
	};
}

/**
 * The `use:enhance` callback for one card's form. A second submit while one is in flight is
 * cancelled. When the action returns, `update()` refreshes page data and `form` as a plain
 * submit would, and the pending state is cleared whatever happened: success, failure, a
 * thrown error or a redirect.
 */
export function runSubmit(tracker: RunTracker, key: string): SubmitFunction {
	return ({ cancel }) => {
		if (!tracker.begin(key)) {
			cancel();
			return;
		}
		return async ({ update }) => {
			try {
				await update();
			} finally {
				tracker.end(key);
			}
		};
	};
}
